import prisma from "../../db.server";
import { detectLeaks } from "../../domain/leaks";
import { previousPeriod, resolvePeriod } from "../../lib/dates";
import { formatMoney } from "../../lib/money";
import { logger } from "../../lib/logger.server";
import { orderProfitsInPeriod, periodSummary, productMetrics } from "../profit/reporting.server";

/**
 * Run the deterministic leak detector for the trailing 7 days vs the 7 days
 * before, and upsert results. Leaks that are no longer detected are resolved
 * automatically; dismissed leaks stay dismissed.
 */
export async function runLeakDetection(storeId: string): Promise<{ detected: number; resolved: number }> {
  const store = await prisma.store.findUniqueOrThrow({ where: { id: storeId }, select: { currency: true, ianaTimezone: true } });
  const current = resolvePeriod("7d", store.ianaTimezone);
  const previous = previousPeriod(current);

  const [cur, prev, orders, prevOrders, lastSync] = await Promise.all([
    periodSummary(storeId, current),
    periodSummary(storeId, previous),
    orderProfitsInPeriod(storeId, current),
    orderProfitsInPeriod(storeId, previous),
    prisma.syncJob.findFirst({ where: { storeId, type: { in: ["HISTORICAL_ORDERS", "INCREMENTAL_ORDERS"] }, status: "COMPLETED" }, orderBy: { finishedAt: "desc" }, select: { finishedAt: true } }),
  ]);
  const curProfits = orders.map((o) => o.profit);
  const [products, previousProducts] = await Promise.all([
    productMetrics(storeId, current, { adSpendMinor: cur.adSpendMinor, orders: curProfits }),
    productMetrics(storeId, previous, { adSpendMinor: prev.adSpendMinor, orders: prevOrders.map((o) => o.profit) }),
  ]);
  const lowMargin = orders.filter((o) => !o.profit.isExcluded && o.profit.contributionMarginBps !== null && o.profit.contributionMarginBps < 500);

  const leaks = detectLeaks({
    currency: store.currency,
    current: cur,
    previous: prev,
    products,
    previousProducts,
    lowMarginOrderCount: lowMargin.length,
    lowMarginOrderIds: lowMargin.slice(0, 20).map((o) => o.profit.orderId),
    orderSyncAgeMinutes: lastSync?.finishedAt ? Math.round((Date.now() - lastSync.finishedAt.getTime()) / 60_000) : null,
    formatMoney: (m) => formatMoney(m, store.currency),
  });

  const fingerprints = leaks.map((l) => l.fingerprint);
  let resolved = 0;
  await prisma.$transaction(async (tx) => {
    for (const leak of leaks) {
      const existing = await tx.profitLeak.findUnique({ where: { storeId_fingerprint: { storeId, fingerprint: leak.fingerprint } }, select: { id: true, status: true } });
      const data = {
        type: leak.type,
        severity: leak.severity,
        title: leak.title,
        evidenceJson: JSON.parse(JSON.stringify(leak.evidence)),
        entityType: leak.entityType,
        entityId: leak.entityId,
        periodStart: leak.periodStart,
        periodEnd: leak.periodEnd,
        impactMinor: leak.impactMinor,
      };
      if (!existing) {
        await tx.profitLeak.create({ data: { storeId, fingerprint: leak.fingerprint, ...data } });
      } else if (existing.status === "DISMISSED") {
        await tx.profitLeak.update({ where: { id: existing.id }, data });
      } else {
        await tx.profitLeak.update({ where: { id: existing.id }, data: { ...data, status: "OPEN", resolvedAt: null } });
      }
    }
    const res = await tx.profitLeak.updateMany({
      where: { storeId, status: "OPEN", periodStart: current.start, fingerprint: { notIn: fingerprints } },
      data: { status: "RESOLVED", resolvedAt: new Date() },
    });
    resolved = res.count;
  });
  logger.info({ storeId, detected: leaks.length, resolved }, "leak detection complete");
  return { detected: leaks.length, resolved };
}
