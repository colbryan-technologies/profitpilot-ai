import type { Prisma } from "@prisma/client";
import { storedCoverage } from "../import-coverage.server";
import prisma from "../../db.server";
import { HistoryCogsResolver } from "../../domain/profit/cogs";
import { computeOrderProfit } from "../../domain/profit/order";
import { summarizePeriod } from "../../domain/profit/aggregate";
import type {
  CalculationContext,
  ExpenseInput,
  OrderInput,
  OrderProfit,
  PeriodSummary,
  RefundLineInput,
} from "../../domain/profit/types";
import {
  computeConfidence,
  type ConfidenceInput,
} from "../../domain/confidence";
import { addDays, dayFromString, localDateString } from "../../lib/dates";
import { logger } from "../../lib/logger.server";

const BATCH = 500;

export async function buildCalculationContext(
  storeId: string,
): Promise<CalculationContext> {
  const [store, fee, tax, rules, cogs, variants] = await Promise.all([
    prisma.store.findUniqueOrThrow({
      where: { id: storeId },
      select: { currency: true },
    }),
    prisma.feeConfig.findUnique({ where: { storeId } }),
    prisma.taxConfig.findUnique({ where: { storeId } }),
    prisma.shippingCostRule.findMany({ where: { storeId } }),
    prisma.cogsHistory.findMany({
      where: { storeId },
      select: {
        variantId: true,
        unitCostMinor: true,
        currency: true,
        effectiveFrom: true,
      },
    }),
    prisma.variant.findMany({
      where: { storeId, shopifyUnitCostMinor: { not: null } },
      select: {
        id: true,
        shopifyUnitCostMinor: true,
        shopifyUnitCostCurrency: true,
      },
    }),
  ]);
  const overrides = (fee?.gatewayOverrides ?? {}) as Record<
    string,
    { percentBps: number; fixedMinor: number }
  >;
  return {
    currency: store.currency,
    taxTreatment: tax?.treatment ?? "UNCONFIGURED",
    fees: {
      percentBps: fee?.percentBps ?? 290,
      fixedMinor: fee?.fixedMinor ?? 30,
      gatewayOverrides: overrides,
    },
    shippingRules: rules
      .filter((r) => r.currency === store.currency)
      .map((r) => ({
        countryCode: r.countryCode,
        flatMinor: r.flatMinor,
        perItemMinor: r.perItemMinor,
        percentBps: r.percentBps,
        priority: r.priority,
      })),
    cogs: new HistoryCogsResolver(
      cogs.filter((r) => r.currency === store.currency),
      variants
        .filter((v) => v.shopifyUnitCostCurrency === store.currency)
        .map((v) => ({
          variantId: v.id,
          unitCostMinor: v.shopifyUnitCostMinor as number,
        })),
    ),
  };
}

type OrderRow = Prisma.OrderGetPayload<{
  include: { lineItems: true; refunds: true; transactions: true };
}>;

export function toOrderInput(o: OrderRow): OrderInput {
  const lineByShopifyId = new Map(o.lineItems.map((l) => [l.shopifyId, l.id]));
  return {
    id: o.id,
    name: o.name,
    processedAt: o.processedAt,
    cancelledAt: o.cancelledAt,
    currency: o.currency,
    taxesIncluded: o.taxesIncluded,
    isTest: o.isTest,
    subtotalMinor: o.subtotalMinor,
    totalDiscountsMinor: o.totalDiscountsMinor,
    totalShippingMinor: o.totalShippingMinor,
    totalTaxMinor: o.totalTaxMinor,
    totalTipMinor: o.totalTipMinor,
    totalDutiesMinor: o.totalDutiesMinor,
    totalPriceMinor: o.totalPriceMinor,
    shippingCountryCode: o.shippingCountryCode,
    lineItems: o.lineItems.map((l) => ({
      id: l.id,
      variantId: l.variantId,
      productId: l.productId,
      title: l.title,
      sku: l.sku,
      quantity: l.quantity,
      currentQuantity: l.currentQuantity,
      unitPriceMinor: l.unitPriceMinor,
      discountMinor: l.discountMinor,
      taxMinor: l.taxMinor,
      requiresShipping: l.requiresShipping,
      isGiftCard: l.isGiftCard,
    })),
    refunds: o.refunds.map((r) => ({
      id: r.id,
      processedAt: r.processedAt,
      totalRefundedMinor: r.totalRefundedMinor,
      shippingRefundMinor: r.shippingRefundMinor,
      taxRefundMinor: r.taxRefundMinor,
      lineItems: (
        (r.lineItemsJson as Array<{
          lineItemShopifyId: string;
          quantity: number;
          subtotalMinor: number;
          taxMinor?: number;
          restockType: string;
        }>) ?? []
      )
        .map((rl): RefundLineInput | null => {
          const lineItemId = lineByShopifyId.get(rl.lineItemShopifyId);
          if (!lineItemId) return null;
          return {
            lineItemId,
            quantity: rl.quantity,
            subtotalMinor: rl.subtotalMinor,
            taxMinor: rl.taxMinor ?? 0,
            restockType: rl.restockType as RefundLineInput["restockType"],
          };
        })
        .filter((x): x is RefundLineInput => x !== null),
    })),
    transactions: o.transactions.map((t) => ({
      id: t.id,
      kind: t.kind,
      status: t.status,
      gateway: t.gateway,
      amountMinor: t.amountMinor,
      feeMinor: t.feeMinor,
    })),
    actualShippingCostMinor:
      o.shippingCostSource === "ACTUAL" && o.shippingCostMinor !== null
        ? o.shippingCostMinor
        : null,
  };
}

async function persistOrderProfit(o: OrderRow, p: OrderProfit) {
  await prisma.$transaction([
    prisma.order.update({
      where: { id: o.id },
      data: {
        computedAt: new Date(),
        cogsMinor: p.cogsMinor,
        cogsCoverage: p.cogsCoverage,
        paymentFeesMinor: p.paymentFeesMinor,
        shippingCostMinor: p.shippingCostMinor,
        shippingCostSource: p.shippingCostSource,
        contributionProfitMinor: p.contributionProfitMinor,
        calcVersion: p.calcVersion,
      },
    }),
    ...p.lines.map((l) =>
      prisma.lineItem.update({
        where: { id: l.lineItemId },
        data: { unitCogsMinor: l.unitCogsMinor, cogsSource: l.cogsSource },
      }),
    ),
  ]);
}

/**
 * Recompute order-level profit for a store. When `since` is given only orders
 * processed on/after that date are recomputed (used after a COGS change with
 * an effective date, or after incremental sync).
 */
export async function recalculateOrders(
  storeId: string,
  opts: {
    since?: Date | null;
    onlyUncomputed?: boolean;
    onProgress?: (n: number) => Promise<void>;
  } = {},
): Promise<{ processed: number; days: Set<string> }> {
  const ctx = await buildCalculationContext(storeId);
  const store = await prisma.store.findUniqueOrThrow({
    where: { id: storeId },
    select: { ianaTimezone: true },
  });
  const where: Prisma.OrderWhereInput = { storeId };
  if (opts.since) where.processedAt = { gte: opts.since };
  if (opts.onlyUncomputed) where.computedAt = null;

  let cursor: string | undefined;
  let processed = 0;
  const days = new Set<string>();
  for (;;) {
    const rows = await prisma.order.findMany({
      where,
      include: { lineItems: true, refunds: true, transactions: true },
      orderBy: { id: "asc" },
      take: BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (rows.length === 0) break;
    for (const row of rows) {
      const profit = computeOrderProfit(toOrderInput(row), ctx);
      await persistOrderProfit(row, profit);
      days.add(localDateString(row.processedAt, store.ianaTimezone));
      for (const r of row.refunds)
        days.add(localDateString(r.processedAt, store.ianaTimezone));
      processed++;
    }
    cursor = rows[rows.length - 1].id;
    await opts.onProgress?.(processed);
  }
  return { processed, days };
}

/** Compute profit for the orders processed on a given local calendar day. */
export async function summarizeDay(
  storeId: string,
  ymd: string,
  ctx?: CalculationContext,
): Promise<{
  summary: PeriodSummary;
  orders: OrderProfit[];
  rows: OrderRow[];
}> {
  const store = await prisma.store.findUniqueOrThrow({
    where: { id: storeId },
    select: { currency: true, ianaTimezone: true },
  });
  const calc = ctx ?? (await buildCalculationContext(storeId));
  const dayStart = dayFromString(ymd);
  const dayEnd = addDays(dayStart, 1);
  // Query with a generous UTC window then filter by local date so timezone boundaries are exact.
  const rows = await prisma.order.findMany({
    where: {
      storeId,
      processedAt: { gte: addDays(dayStart, -1), lt: addDays(dayEnd, 1) },
    },
    include: { lineItems: true, refunds: true, transactions: true },
  });
  const dayRows = rows.filter(
    (r) => localDateString(r.processedAt, store.ianaTimezone) === ymd,
  );
  const orders = dayRows.map((r) => computeOrderProfit(toOrderInput(r), calc));

  const [adSpend, expenses] = await Promise.all([
    prisma.adSpend.aggregate({
      where: { storeId, date: dayStart, currency: store.currency },
      _sum: { spendMinor: true },
    }),
    prisma.expense.findMany({
      where: {
        storeId,
        startsOn: { lt: dayEnd },
        OR: [{ endsOn: null }, { endsOn: { gte: dayStart } }],
      },
    }),
  ]);
  const expenseInputs: ExpenseInput[] = expenses.map((e) => ({
    id: e.id,
    amountMinor: e.amountMinor,
    currency: e.currency,
    recurrence: e.recurrence,
    startsOn: e.startsOn,
    endsOn: e.endsOn,
  }));
  const summary = summarizePeriod({
    currency: store.currency,
    periodStart: dayStart,
    periodEnd: dayEnd,
    orders,
    adSpendMinor: adSpend._sum.spendMinor ?? 0,
    expenses: expenseInputs,
  });
  return { summary, orders, rows: dayRows };
}

async function loadConfidenceContext(storeId: string) {
  const [
    lastOrderSync,
    adAccounts,
    tax,
    fee,
    expenses,
    refundCount,
    txCount,
    missingCogsProducts,
  ] = await Promise.all([
    prisma.syncJob.findFirst({
      where: {
        storeId,
        type: { in: ["HISTORICAL_ORDERS", "INCREMENTAL_ORDERS"] },
        status: "COMPLETED",
      },
      orderBy: { finishedAt: "desc" },
      select: { finishedAt: true },
    }),
    prisma.adAccount.findMany({
      where: { storeId, status: { not: "DISCONNECTED" } },
      select: { status: true, lastSyncedAt: true },
    }),
    prisma.taxConfig.findUnique({ where: { storeId } }),
    prisma.feeConfig.findUnique({ where: { storeId } }),
    prisma.expense.count({ where: { storeId } }),
    prisma.refund.count({ where: { storeId } }),
    prisma.transaction.count({ where: { storeId } }),
    prisma.lineItem.groupBy({
      by: ["productId"],
      where: { storeId, cogsSource: "MISSING", productId: { not: null } },
    }),
  ]);
  return {
    lastOrderSync,
    adAccounts,
    tax,
    fee,
    expenses,
    refundCount,
    txCount,
    missingCogsProducts,
  };
}

export async function confidenceInputForStore(
  storeId: string,
  orders: OrderProfit[],
  context?: Awaited<ReturnType<typeof loadConfidenceContext>>,
): Promise<ConfidenceInput> {
  const {
    lastOrderSync,
    adAccounts,
    tax,
    fee,
    expenses,
    refundCount,
    txCount,
    missingCogsProducts,
  } = context ?? (await loadConfidenceContext(storeId));
  const included = orders.filter((o) => !o.isExcluded);
  const totalQty = included.reduce(
    (a, o) => a + o.lines.reduce((b, l) => b + l.cogsQuantity, 0),
    0,
  );
  const knownQty = included.reduce(
    (a, o) =>
      a +
      o.lines
        .filter((l) => l.cogsSource !== "MISSING")
        .reduce((b, l) => b + l.cogsQuantity, 0),
    0,
  );
  const feeActual = included.filter(
    (o) => o.paymentFeeSource === "ACTUAL",
  ).length;
  const staleAds = adAccounts.filter(
    (a) =>
      a.status !== "CONNECTED" ||
      !a.lastSyncedAt ||
      Date.now() - a.lastSyncedAt.getTime() > 36 * 3_600_000,
  ).length;
  return {
    ordersSynced: !!lastOrderSync,
    orderSyncAgeMinutes: lastOrderSync?.finishedAt
      ? Math.round((Date.now() - lastOrderSync.finishedAt.getTime()) / 60_000)
      : null,
    refundsSynced:
      refundCount > 0 || included.every((o) => o.refundsMinor === 0),
    transactionsSynced: txCount > 0,
    cogsCoveragePct:
      totalQty === 0 ? 100 : Math.round((knownQty / totalQty) * 100),
    productsMissingCogs: missingCogsProducts.length,
    ordersWithoutShippingCost: included.filter(
      (o) => o.shippingCostSource === "UNKNOWN",
    ).length,
    orderCount: included.length,
    paymentFeeActualPct:
      included.length === 0
        ? 100
        : Math.round((feeActual / included.length) * 100),
    feeConfigConfirmed: !!fee?.confirmedAt,
    adAccountsConnected: adAccounts.length,
    adAccountsStale: staleAds,
    taxConfigured: !!tax && tax.treatment !== "UNCONFIGURED",
    hasExpenses: expenses > 0,
  };
}

/** Rebuild ProfitSnapshot rows for the given local days. */
export async function rebuildSnapshots(
  storeId: string,
  ymds: Iterable<string>,
  onProgress?: (completed: number, total: number) => Promise<void>,
): Promise<number> {
  const ctx = await buildCalculationContext(storeId);
  // These store-wide inputs are identical for every day in this rebuild.
  const confidenceContext = await loadConfidenceContext(storeId);
  const dates = Array.from(ymds);
  const store = await prisma.store.findUniqueOrThrow({
    where: { id: storeId },
    select: { currency: true },
  });
  let n = 0;
  for (const ymd of dates) {
    const { summary, orders } = await summarizeDay(storeId, ymd, ctx);
    const confidence = computeConfidence(
      await confidenceInputForStore(storeId, orders, confidenceContext),
    );
    const date = dayFromString(ymd);
    const data = {
      currency: store.currency,
      orderCount: summary.orderCount,
      grossSalesMinor: summary.grossSalesMinor,
      discountsMinor: summary.discountsMinor,
      refundsMinor: summary.refundsMinor,
      netSalesMinor: summary.netSalesMinor,
      cogsMinor: summary.cogsMinor,
      grossProfitMinor: summary.grossProfitMinor,
      shippingRevenueMinor: summary.shippingRevenueMinor,
      shippingCostMinor: summary.shippingCostMinor,
      paymentFeesMinor: summary.paymentFeesMinor,
      adSpendMinor: summary.adSpendMinor,
      taxCollectedMinor: summary.taxCollectedMinor,
      otherExpensesMinor: summary.otherExpensesMinor,
      contributionProfitMinor: summary.contributionProfitMinor,
      netProfitMinor: summary.netProfitMinor,
      confidenceScore: confidence.score,
      confidenceJson: JSON.parse(JSON.stringify(confidence)),
      calcVersion: summary.calcVersion,
      computedAt: new Date(),
    };
    await prisma.profitSnapshot.upsert({
      where: { storeId_date: { storeId, date } },
      create: { storeId, date, ...data },
      update: data,
    });
    n++;
    if (n % 10 === 0 || n === dates.length) await onProgress?.(n, dates.length);
  }
  logger.debug({ storeId, days: n }, "snapshots rebuilt");
  return n;
}

/** Full recalculation: every order, then every day from first order to today. */
export async function recalculateStore(
  storeId: string,
  opts: {
    since?: Date | null;
    onProgress?: (msg: string, pct: number) => Promise<void>;
  } = {},
): Promise<{ orders: number; days: number }> {
  const { processed, days } = await recalculateOrders(storeId, {
    since: opts.since ?? null,
    onProgress: async (n) =>
      opts.onProgress?.(
        `Recalculated ${n} orders`,
        Math.min(60, Math.round(n / 50)),
      ),
  });
  const store = await prisma.store.findUniqueOrThrow({
    where: { id: storeId },
    select: { ianaTimezone: true },
  });
  // Also refresh days without orders so recurring expenses/ad spend show up.
  const first = await prisma.order.findFirst({
    where: {
      storeId,
      ...(opts.since ? { processedAt: { gte: opts.since } } : {}),
    },
    orderBy: { processedAt: "asc" },
    select: { processedAt: true },
  });
  const allDays = new Set(days);
  const coverage = await storedCoverage(storeId, store.ianaTimezone);
  for (const day of coverage.days)
    if (!opts.since || day >= localDateString(opts.since, store.ianaTimezone))
      allDays.add(day);
  // Rebuild persisted dates even after their last order is deleted.
  const existingDays = await prisma.profitSnapshot.findMany({
    where: {
      storeId,
      ...(opts.since
        ? {
            date: {
              gte: dayFromString(
                localDateString(opts.since, store.ianaTimezone),
              ),
            },
          }
        : {}),
    },
    select: { date: true },
  });
  for (const row of existingDays)
    allDays.add(row.date.toISOString().slice(0, 10));
  const costs = await prisma.expense.findMany({
    where: { storeId },
    select: { startsOn: true },
  });
  const adDates = await prisma.adSpend.findMany({
    where: { storeId },
    select: { date: true },
    distinct: ["date"],
  });
  for (const row of adDates) allDays.add(row.date.toISOString().slice(0, 10));
  const starts = costs.map((c) => c.startsOn);
  if (first) starts.push(first.processedAt);
  const earliest = starts.sort((a, b) => a.getTime() - b.getTime())[0];
  if (earliest) {
    let d = dayFromString(localDateString(earliest, store.ianaTimezone));
    if (opts.since && d < opts.since)
      d = dayFromString(localDateString(opts.since, store.ianaTimezone));
    const today = dayFromString(
      localDateString(new Date(), store.ianaTimezone),
    );
    while (d <= today) {
      allDays.add(localDateString(d, "UTC"));
      d = addDays(d, 1);
    }
  }
  await opts.onProgress?.("Rebuilding daily snapshots", 70);
  const n = await rebuildSnapshots(storeId, allDays, async (completed, total) =>
    opts.onProgress?.(
      "Rebuilding daily snapshots",
      70 + Math.floor((29 * completed) / total),
    ),
  );
  await opts.onProgress?.("Done", 100);
  return { orders: processed, days: n };
}
