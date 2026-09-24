/**
 * Profit Leak Detector — deterministic, rule-based detection.
 *
 * Every detector receives already-calculated metrics for the current period
 * and the immediately preceding period and returns structured evidence. No
 * AI is involved here; an optional AI explanation may be generated later using
 * *only* the evidence emitted from these rules.
 *
 * Thresholds are documented in docs/methodology/profit-leaks.md.
 */
import { createHash } from "node:crypto";
import { percentChange, ratio } from "../../lib/money";
import type { PeriodSummary } from "../profit/types";

export type LeakType =
  | "AD_SPEND_INCREASE"
  | "MARGIN_SHRINK"
  | "REFUND_RATE_HIGH"
  | "MISSING_COGS"
  | "SHIPPING_COST_INCREASE"
  | "DISCOUNT_INCREASE"
  | "PAYMENT_FEE_CHANGE"
  | "NEAR_BREAK_EVEN_PRODUCT"
  | "LOSS_MAKING_PRODUCT"
  | "LOW_MARGIN_ORDERS"
  | "EXPENSE_SPIKE"
  | "DATA_STALE";

export type LeakSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface LeakEvidence {
  /** Human-readable measured facts, e.g. "Ad spend rose from €4,500 to €5,320 (+18.2%)". */
  facts: string[];
  /** Raw numbers used, for auditability and AI grounding. */
  metrics: Record<string, number | string | null>;
  /** The largest measured cost drivers, ordered by absolute impact. */
  drivers?: Array<{ label: string; deltaMinor: number }>;
  comparison: { currentStart: string; currentEnd: string; previousStart: string; previousEnd: string };
}

export interface DetectedLeak {
  type: LeakType;
  severity: LeakSeverity;
  title: string;
  entityType: "store" | "product" | "variant" | "order" | "adAccount";
  entityId: string | null;
  impactMinor: number | null;
  evidence: LeakEvidence;
  fingerprint: string;
  periodStart: Date;
  periodEnd: Date;
}

export interface ProductPeriodMetrics {
  productId: string;
  title: string;
  unitsSold: number;
  netSalesMinor: number;
  cogsMinor: number;
  grossProfitMinor: number;
  /** Allocated share of order-level shipping, fees, and refunds. */
  allocatedCostsMinor: number;
  /** Allocated ad spend (by share of net sales) — labelled as allocation, never attribution. */
  allocatedAdSpendMinor: number;
  contributionProfitMinor: number;
  missingCogs: boolean;
  refundedUnits: number;
}

export interface LeakDetectionInput {
  currency: string;
  current: PeriodSummary;
  previous: PeriodSummary;
  products: ProductPeriodMetrics[];
  previousProducts: ProductPeriodMetrics[];
  /** Orders in the current period with contribution margin below the threshold. */
  lowMarginOrderCount: number;
  lowMarginOrderIds: string[];
  orderSyncAgeMinutes: number | null;
  formatMoney: (minor: number) => string;
}

export const THRESHOLDS = {
  adSpendIncreasePct: 15,
  minAdSpendMinor: 5_000, // ignore noise below 50.00
  marginShrinkPoints: 5, // percentage points of contribution margin
  refundRatePct: 8,
  refundRateIncreasePct: 30,
  shippingCostIncreasePct: 15,
  discountRateIncreasePoints: 5,
  paymentFeeRateChangeBps: 40,
  nearBreakEvenMarginPct: 8,
  minProductNetSalesMinor: 10_000,
  lowMarginOrderMarginPct: 5,
  lowMarginOrderShareSpike: 20,
  expenseSpikePct: 40,
  staleMinutes: 24 * 60,
} as const;

function fp(type: LeakType, entityId: string | null, periodStart: Date): string {
  return createHash("sha256").update(`${type}|${entityId ?? "store"}|${periodStart.toISOString().slice(0, 10)}`).digest("hex").slice(0, 32);
}

function pct(n: number, d: number): number | null {
  const r = ratio(n, d);
  return r === null ? null : Math.round(r * 1000) / 10;
}

function comparison(cur: PeriodSummary, prev: PeriodSummary) {
  return {
    currentStart: cur.periodStart.toISOString().slice(0, 10),
    currentEnd: cur.periodEnd.toISOString().slice(0, 10),
    previousStart: prev.periodStart.toISOString().slice(0, 10),
    previousEnd: prev.periodEnd.toISOString().slice(0, 10),
  };
}

function severityFromImpact(impactMinor: number, netSalesMinor: number): LeakSeverity {
  const share = ratio(Math.abs(impactMinor), Math.max(1, netSalesMinor)) ?? 0;
  if (share >= 0.1) return "CRITICAL";
  if (share >= 0.05) return "HIGH";
  if (share >= 0.02) return "MEDIUM";
  return "LOW";
}

/** Largest movements between periods among cost lines, descending by absolute delta. */
export function costDrivers(cur: PeriodSummary, prev: PeriodSummary, fmt: (m: number) => string): Array<{ label: string; deltaMinor: number; text: string }> {
  const items: Array<{ label: string; deltaMinor: number }> = [
    { label: "Advertising", deltaMinor: cur.adSpendMinor - prev.adSpendMinor },
    { label: "COGS", deltaMinor: cur.cogsMinor - prev.cogsMinor },
    { label: "Refunds", deltaMinor: cur.refundsMinor - prev.refundsMinor },
    { label: "Discounts", deltaMinor: cur.discountsMinor - prev.discountsMinor },
    { label: "Shipping cost", deltaMinor: cur.shippingCostMinor - prev.shippingCostMinor },
    { label: "Payment fees", deltaMinor: cur.paymentFeesMinor - prev.paymentFeesMinor },
    { label: "Other expenses", deltaMinor: cur.otherExpensesMinor - prev.otherExpensesMinor },
  ];
  return items
    .filter((i) => i.deltaMinor !== 0)
    .sort((a, b) => Math.abs(b.deltaMinor) - Math.abs(a.deltaMinor))
    .map((i) => ({ ...i, text: `${i.label} ${i.deltaMinor > 0 ? "increased" : "decreased"} by ${fmt(Math.abs(i.deltaMinor))}` }));
}

export function detectLeaks(input: LeakDetectionInput): DetectedLeak[] {
  const { current: cur, previous: prev, formatMoney: fmt } = input;
  const leaks: DetectedLeak[] = [];
  const cmp = comparison(cur, prev);
  const base = { periodStart: cur.periodStart, periodEnd: cur.periodEnd };

  // 1. Ad spend increase
  {
    const change = percentChange(cur.adSpendMinor, prev.adSpendMinor);
    if (change !== null && change >= THRESHOLDS.adSpendIncreasePct && cur.adSpendMinor >= THRESHOLDS.minAdSpendMinor) {
      const delta = cur.adSpendMinor - prev.adSpendMinor;
      const salesChange = percentChange(cur.netSalesMinor, prev.netSalesMinor);
      leaks.push({
        ...base,
        type: "AD_SPEND_INCREASE",
        severity: severityFromImpact(delta, cur.netSalesMinor),
        title: `Advertising cost ↑${change.toFixed(1)}%`,
        entityType: "store",
        entityId: null,
        impactMinor: -delta,
        fingerprint: fp("AD_SPEND_INCREASE", null, cur.periodStart),
        evidence: {
          facts: [
            `Ad spend rose from ${fmt(prev.adSpendMinor)} to ${fmt(cur.adSpendMinor)} (+${change.toFixed(1)}%).`,
            salesChange === null ? "Net sales comparison unavailable." : `Net sales changed ${salesChange >= 0 ? "+" : ""}${salesChange.toFixed(1)}% over the same comparison.`,
            cur.roas !== null && cur.breakEvenRoas !== null ? `ROAS is ${cur.roas.toFixed(2)} against a break-even ROAS of ${cur.breakEvenRoas.toFixed(2)}.` : "ROAS unavailable.",
          ],
          metrics: { adSpendCurrent: cur.adSpendMinor, adSpendPrevious: prev.adSpendMinor, changePct: change, roas: cur.roas, breakEvenRoas: cur.breakEvenRoas },
          comparison: cmp,
        },
      });
    }
  }

  // 2. Margin shrink (store-level contribution margin)
  if (cur.contributionMarginBps !== null && prev.contributionMarginBps !== null && cur.netSalesMinor > 0) {
    const dropPoints = (prev.contributionMarginBps - cur.contributionMarginBps) / 100;
    if (dropPoints >= THRESHOLDS.marginShrinkPoints) {
      const drivers = costDrivers(cur, prev, fmt);
      const impact = Math.round((cur.netSalesMinor * dropPoints) / 100);
      leaks.push({
        ...base,
        type: "MARGIN_SHRINK",
        severity: severityFromImpact(impact, cur.netSalesMinor),
        title: `Contribution margin ↓${dropPoints.toFixed(1)} pts`,
        entityType: "store",
        entityId: null,
        impactMinor: -impact,
        fingerprint: fp("MARGIN_SHRINK", null, cur.periodStart),
        evidence: {
          facts: [
            `Contribution margin fell from ${(prev.contributionMarginBps / 100).toFixed(1)}% to ${(cur.contributionMarginBps / 100).toFixed(1)}%.`,
            ...drivers.slice(0, 3).map((d) => `${d.text} — one of the largest changes associated with the margin drop.`),
          ],
          metrics: { marginCurrentBps: cur.contributionMarginBps, marginPreviousBps: prev.contributionMarginBps, dropPoints },
          drivers: drivers.slice(0, 5).map(({ label, deltaMinor }) => ({ label, deltaMinor })),
          comparison: cmp,
        },
      });
    }
  }

  // 3. Refund rate
  if (cur.refundRateBps !== null && cur.grossSalesMinor > 0) {
    const rate = cur.refundRateBps / 100;
    const prevRate = prev.refundRateBps === null ? null : prev.refundRateBps / 100;
    const increase = prevRate === null || prevRate === 0 ? null : ((rate - prevRate) / prevRate) * 100;
    if (rate >= THRESHOLDS.refundRatePct || (increase !== null && increase >= THRESHOLDS.refundRateIncreasePct && rate >= 3)) {
      leaks.push({
        ...base,
        type: "REFUND_RATE_HIGH",
        severity: rate >= 15 ? "HIGH" : "MEDIUM",
        title: `Refund rate elevated at ${rate.toFixed(1)}%`,
        entityType: "store",
        entityId: null,
        impactMinor: -cur.refundsMinor,
        fingerprint: fp("REFUND_RATE_HIGH", null, cur.periodStart),
        evidence: {
          facts: [
            `Refunds totalled ${fmt(cur.refundsMinor)}, ${rate.toFixed(1)}% of sales after discounts.`,
            prevRate === null ? "No prior-period refund data." : `Previous period refund rate was ${prevRate.toFixed(1)}%.`,
          ],
          metrics: { refundRatePct: rate, previousRefundRatePct: prevRate, refundsMinor: cur.refundsMinor },
          comparison: cmp,
        },
      });
    }
  }

  // 4. Missing COGS
  {
    const missing = input.products.filter((p) => p.missingCogs && p.unitsSold > 0);
    if (missing.length > 0) {
      const affectedSales = missing.reduce((a, p) => a + p.netSalesMinor, 0);
      leaks.push({
        ...base,
        type: "MISSING_COGS",
        severity: affectedSales / Math.max(1, cur.netSalesMinor) > 0.1 ? "HIGH" : "MEDIUM",
        title: `${missing.length} product${missing.length === 1 ? "" : "s"} missing COGS`,
        entityType: "store",
        entityId: null,
        impactMinor: null,
        fingerprint: fp("MISSING_COGS", null, cur.periodStart),
        evidence: {
          facts: [
            `${missing.length} sold product${missing.length === 1 ? "" : "s"} have no cost recorded; ${fmt(affectedSales)} of net sales is treated as 100% margin.`,
            ...missing.slice(0, 5).map((p) => `${p.title}: ${p.unitsSold} units, ${fmt(p.netSalesMinor)} net sales.`),
          ],
          metrics: { productCount: missing.length, affectedNetSalesMinor: affectedSales, productIds: missing.map((p) => p.productId).join(",") },
          comparison: cmp,
        },
      });
    }
  }

  // 5. Shipping cost increase (per order)
  if (cur.orderCount > 0 && prev.orderCount > 0) {
    const perOrderCur = cur.shippingCostMinor / cur.orderCount;
    const perOrderPrev = prev.shippingCostMinor / prev.orderCount;
    const change = percentChange(Math.round(perOrderCur), Math.round(perOrderPrev));
    if (change !== null && change >= THRESHOLDS.shippingCostIncreasePct && cur.shippingCostMinor > 0) {
      const delta = cur.shippingCostMinor - prev.shippingCostMinor;
      leaks.push({
        ...base,
        type: "SHIPPING_COST_INCREASE",
        severity: severityFromImpact(delta, cur.netSalesMinor),
        title: `Shipping cost per order ↑${change.toFixed(1)}%`,
        entityType: "store",
        entityId: null,
        impactMinor: -Math.max(0, delta),
        fingerprint: fp("SHIPPING_COST_INCREASE", null, cur.periodStart),
        evidence: {
          facts: [`Average shipping cost per order moved from ${fmt(Math.round(perOrderPrev))} to ${fmt(Math.round(perOrderCur))}.`],
          metrics: { perOrderCurrent: Math.round(perOrderCur), perOrderPrevious: Math.round(perOrderPrev), changePct: change },
          comparison: cmp,
        },
      });
    }
  }

  // 6. Discount increase
  if (cur.discountRateBps !== null && prev.discountRateBps !== null) {
    const points = (cur.discountRateBps - prev.discountRateBps) / 100;
    if (points >= THRESHOLDS.discountRateIncreasePoints) {
      leaks.push({
        ...base,
        type: "DISCOUNT_INCREASE",
        severity: points >= 10 ? "HIGH" : "MEDIUM",
        title: `Discount rate ↑${points.toFixed(1)} pts`,
        entityType: "store",
        entityId: null,
        impactMinor: -(cur.discountsMinor - prev.discountsMinor),
        fingerprint: fp("DISCOUNT_INCREASE", null, cur.periodStart),
        evidence: {
          facts: [`Discounts were ${(cur.discountRateBps / 100).toFixed(1)}% of gross sales versus ${(prev.discountRateBps / 100).toFixed(1)}% previously (${fmt(cur.discountsMinor)} total).`],
          metrics: { discountRateBps: cur.discountRateBps, previousDiscountRateBps: prev.discountRateBps },
          comparison: cmp,
        },
      });
    }
  }

  // 7. Payment fee rate change
  if (cur.netSalesMinor > 0 && prev.netSalesMinor > 0) {
    const curBps = Math.round((cur.paymentFeesMinor / cur.netSalesMinor) * 10_000);
    const prevBps = Math.round((prev.paymentFeesMinor / prev.netSalesMinor) * 10_000);
    if (curBps - prevBps >= THRESHOLDS.paymentFeeRateChangeBps) {
      leaks.push({
        ...base,
        type: "PAYMENT_FEE_CHANGE",
        severity: "LOW",
        title: `Payment fee rate ↑${((curBps - prevBps) / 100).toFixed(2)} pts`,
        entityType: "store",
        entityId: null,
        impactMinor: -Math.round((cur.netSalesMinor * (curBps - prevBps)) / 10_000),
        fingerprint: fp("PAYMENT_FEE_CHANGE", null, cur.periodStart),
        evidence: {
          facts: [`Payment fees were ${(curBps / 100).toFixed(2)}% of net sales versus ${(prevBps / 100).toFixed(2)}% previously.`],
          metrics: { feeRateBps: curBps, previousFeeRateBps: prevBps },
          comparison: cmp,
        },
      });
    }
  }

  // 8/9. Product-level: near break-even and loss-making
  for (const p of input.products) {
    if (p.netSalesMinor < THRESHOLDS.minProductNetSalesMinor || p.missingCogs) continue;
    const margin = pct(p.contributionProfitMinor, p.netSalesMinor);
    if (margin === null) continue;
    const prevP = input.previousProducts.find((x) => x.productId === p.productId);
    const facts = [
      `${p.title}: net sales ${fmt(p.netSalesMinor)}, COGS ${fmt(p.cogsMinor)}, allocated shipping/fees/refunds ${fmt(p.allocatedCostsMinor)}, allocated advertising ${fmt(p.allocatedAdSpendMinor)}.`,
      `Estimated contribution profit ${fmt(p.contributionProfitMinor)} (margin ${margin.toFixed(1)}%). Advertising is allocated by share of net sales, not attributed.`,
    ];
    if (prevP) {
      const prevMargin = pct(prevP.contributionProfitMinor, prevP.netSalesMinor);
      if (prevMargin !== null) facts.push(`Previous period margin was ${prevMargin.toFixed(1)}%.`);
    }
    const metrics = { netSalesMinor: p.netSalesMinor, cogsMinor: p.cogsMinor, allocatedCostsMinor: p.allocatedCostsMinor, allocatedAdSpendMinor: p.allocatedAdSpendMinor, contributionProfitMinor: p.contributionProfitMinor, marginPct: margin, unitsSold: p.unitsSold };
    if (p.contributionProfitMinor < 0) {
      leaks.push({
        ...base,
        type: "LOSS_MAKING_PRODUCT",
        severity: severityFromImpact(p.contributionProfitMinor, cur.netSalesMinor) === "LOW" ? "MEDIUM" : "HIGH",
        title: `${p.title} is loss-making`,
        entityType: "product",
        entityId: p.productId,
        impactMinor: p.contributionProfitMinor,
        fingerprint: fp("LOSS_MAKING_PRODUCT", p.productId, cur.periodStart),
        evidence: { facts, metrics, comparison: cmp },
      });
    } else if (margin < THRESHOLDS.nearBreakEvenMarginPct) {
      leaks.push({
        ...base,
        type: "NEAR_BREAK_EVEN_PRODUCT",
        severity: "MEDIUM",
        title: `${p.title} margin at ${margin.toFixed(1)}%`,
        entityType: "product",
        entityId: p.productId,
        impactMinor: null,
        fingerprint: fp("NEAR_BREAK_EVEN_PRODUCT", p.productId, cur.periodStart),
        evidence: { facts, metrics, comparison: cmp },
      });
    }
  }

  // 10. Low-margin orders
  if (cur.orderCount > 0) {
    const share = (input.lowMarginOrderCount / cur.orderCount) * 100;
    if (share >= THRESHOLDS.lowMarginOrderShareSpike && input.lowMarginOrderCount >= 3) {
      leaks.push({
        ...base,
        type: "LOW_MARGIN_ORDERS",
        severity: share >= 40 ? "HIGH" : "MEDIUM",
        title: `${input.lowMarginOrderCount} orders below ${THRESHOLDS.lowMarginOrderMarginPct}% margin`,
        entityType: "store",
        entityId: null,
        impactMinor: null,
        fingerprint: fp("LOW_MARGIN_ORDERS", null, cur.periodStart),
        evidence: {
          facts: [`${share.toFixed(0)}% of orders in the period had a contribution margin below ${THRESHOLDS.lowMarginOrderMarginPct}%.`],
          metrics: { lowMarginOrderCount: input.lowMarginOrderCount, orderCount: cur.orderCount, sharePct: share, orderIds: input.lowMarginOrderIds.slice(0, 20).join(",") },
          comparison: cmp,
        },
      });
    }
  }

  // 11. Expense spike
  {
    const change = percentChange(cur.otherExpensesMinor, prev.otherExpensesMinor);
    if (change !== null && change >= THRESHOLDS.expenseSpikePct && cur.otherExpensesMinor > THRESHOLDS.minAdSpendMinor) {
      leaks.push({
        ...base,
        type: "EXPENSE_SPIKE",
        severity: severityFromImpact(cur.otherExpensesMinor - prev.otherExpensesMinor, cur.netSalesMinor),
        title: `Operating expenses ↑${change.toFixed(0)}%`,
        entityType: "store",
        entityId: null,
        impactMinor: -(cur.otherExpensesMinor - prev.otherExpensesMinor),
        fingerprint: fp("EXPENSE_SPIKE", null, cur.periodStart),
        evidence: {
          facts: [`Recorded expenses rose from ${fmt(prev.otherExpensesMinor)} to ${fmt(cur.otherExpensesMinor)}.`],
          metrics: { current: cur.otherExpensesMinor, previous: prev.otherExpensesMinor, changePct: change },
          comparison: cmp,
        },
      });
    }
  }

  // 12. Stale data
  if (input.orderSyncAgeMinutes !== null && input.orderSyncAgeMinutes >= THRESHOLDS.staleMinutes) {
    leaks.push({
      ...base,
      type: "DATA_STALE",
      severity: "MEDIUM",
      title: "Order data is stale",
      entityType: "store",
      entityId: null,
      impactMinor: null,
      fingerprint: fp("DATA_STALE", null, cur.periodStart),
      evidence: {
        facts: [`Orders were last synchronized ${Math.round(input.orderSyncAgeMinutes / 60)} hours ago; recent profitability may be understated.`],
        metrics: { orderSyncAgeMinutes: input.orderSyncAgeMinutes },
        comparison: cmp,
      },
    });
  }

  const order: Record<LeakSeverity, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  return leaks.sort((a, b) => order[a.severity] - order[b.severity] || Math.abs(b.impactMinor ?? 0) - Math.abs(a.impactMinor ?? 0));
}
