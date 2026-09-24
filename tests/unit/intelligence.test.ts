import { describe, expect, it } from "vitest";
import { computeOrderProfit } from "../../app/domain/profit/order";
import { combineSnapshots, expenseAmountInPeriod, summarizePeriod } from "../../app/domain/profit/aggregate";
import { computeConfidence, confidenceLabel } from "../../app/domain/confidence";
import { detectLeaks, type ProductPeriodMetrics } from "../../app/domain/leaks";
import type { PeriodSummary } from "../../app/domain/profit/types";
import { D, ctx, line, order } from "../fixtures/orders";
import { formatMoney } from "../../app/lib/money";

const start = D("2026-05-01T00:00:00Z");
const end = D("2026-06-01T00:00:00Z");

describe("expenseAmountInPeriod", () => {
  it("one-time expense lands in the period containing its date", () => {
    const e = { id: "e", amountMinor: 10_000, currency: "EUR", recurrence: "ONE_TIME" as const, startsOn: D("2026-05-15T00:00:00Z"), endsOn: null };
    expect(expenseAmountInPeriod(e, start, end)).toBe(10_000);
    expect(expenseAmountInPeriod(e, D("2026-06-01T00:00:00Z"), D("2026-07-01T00:00:00Z"))).toBe(0);
  });
  it("accrues monthly expenses per day", () => {
    const e = { id: "e", amountMinor: 36_525, currency: "EUR", recurrence: "MONTHLY" as const, startsOn: D("2026-01-01T00:00:00Z"), endsOn: null };
    // 36525 × 12 / 365.25 = 1200/day × 31 days
    expect(expenseAmountInPeriod(e, start, end)).toBe(37_200);
  });
  it("respects start/end bounds", () => {
    const e = { id: "e", amountMinor: 700, currency: "EUR", recurrence: "WEEKLY" as const, startsOn: D("2026-05-21T00:00:00Z"), endsOn: D("2026-05-31T00:00:00Z") };
    expect(expenseAmountInPeriod(e, start, end)).toBe(1_000); // 10 days × 100
  });
});

describe("summarizePeriod", () => {
  const orders = [computeOrderProfit(order(), ctx()), computeOrderProfit(order({ id: "o2", isTest: true }), ctx())];
  const summary = summarizePeriod({ currency: "EUR", periodStart: start, periodEnd: end, orders, adSpendMinor: 2_000, expenses: [{ id: "e", amountMinor: 1_000, currency: "EUR", recurrence: "ONE_TIME", startsOn: D("2026-05-02T00:00:00Z"), endsOn: null }, { id: "usd", amountMinor: 999, currency: "USD", recurrence: "ONE_TIME", startsOn: D("2026-05-02T00:00:00Z"), endsOn: null }] });

  it("excludes test orders and separates ad spend from expenses", () => {
    expect(summary.orderCount).toBe(1);
    expect(summary.netSalesMinor).toBe(10_000);
    const contributionBeforeAds = 7_900 + 500 - 400 - 334;
    expect(summary.contributionProfitMinor).toBe(contributionBeforeAds - 2_000);
    expect(summary.otherExpensesMinor).toBe(1_000);
    expect(summary.netProfitMinor).toBe(contributionBeforeAds - 2_000 - 1_000);
  });
  it("derives ROAS metrics", () => {
    expect(summary.roas).toBe(5);
    expect(summary.breakEvenRoas).toBeCloseTo(10_000 / 7_666, 3);
    expect(summary.breakEvenCpaMinor).toBe(7_666);
    expect(summary.averageOrderValueMinor).toBe(10_000);
  });
  it("combineSnapshots reproduces the same totals", () => {
    const combined = combineSnapshots("EUR", start, end, [summary, summary]);
    expect(combined.netSalesMinor).toBe(20_000);
    expect(combined.contributionProfitMinor).toBe(summary.contributionProfitMinor * 2);
    expect(combined.contributionMarginBps).toBe(summary.contributionMarginBps);
    expect(combined.breakEvenRoas).toBe(summary.breakEvenRoas);
  });
});

describe("computeConfidence", () => {
  const full = {
    ordersSynced: true,
    orderSyncAgeMinutes: 10,
    refundsSynced: true,
    transactionsSynced: true,
    cogsCoveragePct: 100,
    productsMissingCogs: 0,
    ordersWithoutShippingCost: 0,
    orderCount: 100,
    paymentFeeActualPct: 100,
    feeConfigConfirmed: true,
    adAccountsConnected: 1,
    adAccountsStale: 0,
    taxConfigured: true,
    hasExpenses: true,
  };
  it("scores 100 with complete data", () => {
    const r = computeConfidence(full);
    expect(r.score).toBe(100);
    expect(r.indicators.every((i) => i.status === "ok")).toBe(true);
    expect(confidenceLabel(r.score)).toBe("High");
  });
  it("penalises missing COGS and offers a remediation link", () => {
    const r = computeConfidence({ ...full, cogsCoveragePct: 40, productsMissingCogs: 12 });
    expect(r.score).toBeLessThan(90);
    const cogs = r.indicators.find((i) => i.key === "cogs")!;
    expect(cogs.status).not.toBe("ok");
    expect(cogs.actionHref).toBeTruthy();
  });
  it("is low when nothing is connected", () => {
    const r = computeConfidence({ ...full, ordersSynced: false, orderSyncAgeMinutes: null, refundsSynced: false, transactionsSynced: false, cogsCoveragePct: 0, productsMissingCogs: 50, ordersWithoutShippingCost: 100, paymentFeeActualPct: 0, feeConfigConfirmed: false, adAccountsConnected: 0, taxConfigured: false, hasExpenses: false });
    expect(r.score).toBeLessThan(30);
    expect(confidenceLabel(r.score)).toBe("Low");
  });
});

function summary(overrides: Partial<PeriodSummary>): PeriodSummary {
  return {
    currency: "EUR",
    calcVersion: "test",
    periodStart: start,
    periodEnd: end,
    orderCount: 100,
    grossSalesMinor: 1_000_000,
    discountsMinor: 50_000,
    refundsMinor: 20_000,
    netSalesMinor: 930_000,
    taxCollectedMinor: 0,
    cogsMinor: 400_000,
    grossProfitMinor: 530_000,
    shippingRevenueMinor: 50_000,
    shippingCostMinor: 60_000,
    paymentFeesMinor: 28_000,
    adSpendMinor: 200_000,
    otherExpensesMinor: 50_000,
    contributionProfitMinor: 292_000,
    netProfitMinor: 242_000,
    netMarginBps: 2602,
    grossMarginBps: 5699,
    contributionMarginBps: 3140,
    averageOrderValueMinor: 9_300,
    roas: 4.65,
    breakEvenRoas: 1.89,
    breakEvenCpaMinor: 4_920,
    refundRateBps: 211,
    discountRateBps: 500,
    ...overrides,
  };
}

function product(overrides: Partial<ProductPeriodMetrics> & { productId: string }): ProductPeriodMetrics {
  return { title: overrides.productId, unitsSold: 10, netSalesMinor: 10_000, cogsMinor: 4_000, grossProfitMinor: 6_000, allocatedCostsMinor: 1_000, allocatedAdSpendMinor: 1_000, contributionProfitMinor: 4_000, missingCogs: false, refundedUnits: 0, ...overrides };
}

describe("detectLeaks", () => {
  const base = {
    currency: "EUR",
    products: [] as ProductPeriodMetrics[],
    previousProducts: [] as ProductPeriodMetrics[],
    lowMarginOrderCount: 0,
    lowMarginOrderIds: [] as string[],
    orderSyncAgeMinutes: 5,
    formatMoney: (m: number) => formatMoney(m, "EUR", "en-IE"),
  };

  it("is silent when nothing changed", () => {
    expect(detectLeaks({ ...base, current: summary({}), previous: summary({}) })).toEqual([]);
  });

  it("flags ad spend increases with measured evidence and stable fingerprints", () => {
    const leaks = detectLeaks({ ...base, current: summary({ adSpendMinor: 260_000, contributionProfitMinor: 232_000 }), previous: summary({}) });
    const ad = leaks.find((l) => l.type === "AD_SPEND_INCREASE")!;
    expect(ad).toBeDefined();
    expect(ad.evidence.metrics.adSpendPrevious).toBe(200_000);
    expect(ad.evidence.facts.join(" ")).toMatch(/30(\.0)?%/);
    expect(ad.evidence.facts.join(" ")).not.toMatch(/because|caused/i);
    const again = detectLeaks({ ...base, current: summary({ adSpendMinor: 260_000, contributionProfitMinor: 232_000 }), previous: summary({}) }).find((l) => l.type === "AD_SPEND_INCREASE")!;
    expect(again.fingerprint).toBe(ad.fingerprint);
  });

  it("flags margin shrink, refunds, shipping, discounts and fee changes", () => {
    const leaks = detectLeaks({
      ...base,
      current: summary({ contributionMarginBps: 2400, refundRateBps: 950, refundsMinor: 90_000, shippingCostMinor: 80_000, discountRateBps: 1100, discountsMinor: 110_000, paymentFeesMinor: 40_000 }),
      previous: summary({}),
    });
    const types = leaks.map((l) => l.type);
    expect(types).toContain("MARGIN_SHRINK");
    expect(types).toContain("REFUND_RATE_HIGH");
    expect(types).toContain("SHIPPING_COST_INCREASE");
    expect(types).toContain("DISCOUNT_INCREASE");
    expect(types).toContain("PAYMENT_FEE_CHANGE");
  });

  it("flags product-level problems and missing COGS", () => {
    const leaks = detectLeaks({
      ...base,
      current: summary({}),
      previous: summary({}),
      products: [
        product({ productId: "loss", contributionProfitMinor: -1_500 }),
        product({ productId: "thin", netSalesMinor: 10_000, contributionProfitMinor: 500 }),
        product({ productId: "nocogs", missingCogs: true, cogsMinor: 0 }),
        product({ productId: "fine" }),
      ],
    });
    expect(leaks.find((l) => l.type === "LOSS_MAKING_PRODUCT")?.entityId).toBe("loss");
    expect(leaks.find((l) => l.type === "NEAR_BREAK_EVEN_PRODUCT")?.entityId).toBe("thin");
    expect(leaks.find((l) => l.type === "MISSING_COGS")).toBeDefined();
    expect(leaks.some((l) => l.entityId === "fine")).toBe(false);
  });

  it("flags stale data and expense spikes", () => {
    const leaks = detectLeaks({ ...base, orderSyncAgeMinutes: 60 * 30, current: summary({ otherExpensesMinor: 90_000 }), previous: summary({}) });
    expect(leaks.map((l) => l.type)).toContain("DATA_STALE");
    expect(leaks.map((l) => l.type)).toContain("EXPENSE_SPIKE");
  });

  it("orders by severity then impact", () => {
    const leaks = detectLeaks({ ...base, orderSyncAgeMinutes: 60 * 30, current: summary({ adSpendMinor: 400_000, contributionProfitMinor: 92_000, contributionMarginBps: 989 }), previous: summary({}) });
    const rank = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
    for (let i = 1; i < leaks.length; i++) {
      expect(rank[leaks[i - 1].severity]).toBeLessThanOrEqual(rank[leaks[i].severity]);
    }
  });
});

describe("sanity: engine matches hand-computed fixture", () => {
  it("multi-line mixed order", () => {
    const o = order({
      lineItems: [line({ id: "a", variantId: "v1", quantity: 1, unitPriceMinor: 5000, discountMinor: 500 }), line({ id: "b", variantId: "v2", quantity: 2, unitPriceMinor: 3000 })],
      totalShippingMinor: 600,
      actualShippingCostMinor: 550,
      transactions: [{ id: "t", kind: "SALE", status: "SUCCESS", gateway: "shopify_payments", amountMinor: 11_100, feeMinor: 352 }],
    });
    const r = computeOrderProfit(o, ctx());
    // net sales 5000-500+6000 = 10500; cogs 1050 + 4000 = 5050; GP 5450; +600 -550 -352 = 5148
    expect(r.netSalesMinor).toBe(10_500);
    expect(r.cogsMinor).toBe(5_050);
    expect(r.contributionProfitMinor).toBe(5_148);
    expect(r.contributionMarginBps).toBe(4903);
  });
});
