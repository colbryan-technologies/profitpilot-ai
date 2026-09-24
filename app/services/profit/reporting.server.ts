import prisma from "../../db.server";
import { combineSnapshots } from "../../domain/profit/aggregate";
import { computeOrderProfit } from "../../domain/profit/order";
import type { CalculationContext, OrderProfit, PeriodSummary } from "../../domain/profit/types";
import type { ProductPeriodMetrics } from "../../domain/leaks";
import { allocate } from "../../lib/money";
import { localDateString, type Period } from "../../lib/dates";
import { buildCalculationContext, toOrderInput } from "./recalc.server";

export async function periodSummary(storeId: string, period: Period): Promise<PeriodSummary> {
  const [store, snapshots] = await Promise.all([
    prisma.store.findUniqueOrThrow({ where: { id: storeId }, select: { currency: true } }),
    prisma.profitSnapshot.findMany({ where: { storeId, date: { gte: period.start, lt: period.end } } }),
  ]);
  return combineSnapshots(store.currency, period.start, period.end, snapshots);
}

export interface DailyPoint {
  date: string;
  netSalesMinor: number;
  netProfitMinor: number;
  contributionProfitMinor: number;
  adSpendMinor: number;
  orderCount: number;
  confidenceScore: number;
}

export async function dailySeries(storeId: string, period: Period): Promise<DailyPoint[]> {
  const rows = await prisma.profitSnapshot.findMany({ where: { storeId, date: { gte: period.start, lt: period.end } }, orderBy: { date: "asc" } });
  return rows.map((r) => ({
    date: r.date.toISOString().slice(0, 10),
    netSalesMinor: r.netSalesMinor,
    netProfitMinor: r.netProfitMinor,
    contributionProfitMinor: r.contributionProfitMinor,
    adSpendMinor: r.adSpendMinor,
    orderCount: r.orderCount,
    confidenceScore: r.confidenceScore,
  }));
}

/** Compute per-order profit for a period straight from stored orders (for lists/detail pages). */
export async function orderProfitsInPeriod(storeId: string, period: Period, ctx?: CalculationContext): Promise<Array<{ profit: OrderProfit; name: string; processedAt: Date; shopifyId: string; financialStatus: string | null; customerShopifyId: string | null }>> {
  const [store, calc, rows] = await Promise.all([
    prisma.store.findUniqueOrThrow({ where: { id: storeId }, select: { ianaTimezone: true } }),
    ctx ?? buildCalculationContext(storeId),
    prisma.order.findMany({
      where: { storeId, processedAt: { gte: new Date(period.start.getTime() - 86_400_000), lt: new Date(period.end.getTime() + 86_400_000) } },
      include: { lineItems: true, refunds: true, transactions: true },
      orderBy: { processedAt: "desc" },
    }),
  ]);
  const startYmd = period.start.toISOString().slice(0, 10);
  const endYmd = period.end.toISOString().slice(0, 10);
  return rows
    .filter((r) => {
      const ymd = localDateString(r.processedAt, store.ianaTimezone);
      return ymd >= startYmd && ymd < endYmd;
    })
    .map((r) => ({ profit: computeOrderProfit(toOrderInput(r), calc), name: r.name, processedAt: r.processedAt, shopifyId: r.shopifyId, financialStatus: r.financialStatus, customerShopifyId: r.customerShopifyId }));
}

/**
 * Product profitability for a period. Order-level costs (shipping, fees,
 * refunds of shipping) are allocated to lines by net-sales weight; ad spend
 * is allocated by share of net sales and labelled as an allocation.
 */
export async function productMetrics(storeId: string, period: Period, opts: { adSpendMinor?: number; orders?: OrderProfit[] } = {}): Promise<ProductPeriodMetrics[]> {
  const orders = opts.orders ?? (await orderProfitsInPeriod(storeId, period)).map((o) => o.profit);
  const byProduct = new Map<string, ProductPeriodMetrics>();
  const productIds = new Set<string>();

  for (const o of orders) {
    if (o.isExcluded) continue;
    const orderCosts = o.shippingCostMinor + o.paymentFeesMinor - o.shippingRevenueMinor - o.tipsMinor + o.dutiesMinor;
    const shares = allocate(orderCosts, o.lines.map((l) => Math.max(0, l.netSalesMinor)));
    o.lines.forEach((l, i) => {
      const key = l.productId ?? `unknown:${l.title}`;
      if (l.productId) productIds.add(l.productId);
      const m = byProduct.get(key) ?? { productId: key, title: l.title, unitsSold: 0, netSalesMinor: 0, cogsMinor: 0, grossProfitMinor: 0, allocatedCostsMinor: 0, allocatedAdSpendMinor: 0, contributionProfitMinor: 0, missingCogs: false, refundedUnits: 0 };
      m.unitsSold += l.netQuantity;
      m.refundedUnits += l.quantity - l.netQuantity;
      m.netSalesMinor += l.netSalesMinor;
      m.cogsMinor += l.cogsMinor;
      m.grossProfitMinor += l.grossProfitMinor;
      m.allocatedCostsMinor += shares[i];
      m.missingCogs = m.missingCogs || (l.cogsSource === "MISSING" && l.cogsQuantity > 0);
      byProduct.set(key, m);
    });
  }

  const list = [...byProduct.values()];
  if (opts.adSpendMinor && opts.adSpendMinor > 0 && list.length) {
    const alloc = allocate(opts.adSpendMinor, list.map((m) => Math.max(0, m.netSalesMinor)));
    list.forEach((m, i) => (m.allocatedAdSpendMinor = alloc[i]));
  }
  for (const m of list) m.contributionProfitMinor = m.grossProfitMinor - m.allocatedCostsMinor - m.allocatedAdSpendMinor;

  if (productIds.size) {
    const products = await prisma.product.findMany({ where: { storeId, id: { in: [...productIds] } }, select: { id: true, title: true } });
    const titles = new Map(products.map((p) => [p.id, p.title]));
    for (const m of list) m.title = titles.get(m.productId) ?? m.title;
  }
  return list.sort((a, b) => b.netSalesMinor - a.netSalesMinor);
}
