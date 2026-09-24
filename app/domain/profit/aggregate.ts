import Decimal from "decimal.js";
import { daysBetween } from "../../lib/dates";
import { ratio } from "../../lib/money";
import type { ExpenseInput, OrderProfit, PeriodSummary } from "./types";
import { CALC_VERSION } from "./types";

function bps(numerator: number, denominator: number): number | null {
  const r = ratio(numerator, denominator);
  return r === null ? null : Math.round(r * 10_000);
}

function round4(n: Decimal): number {
  return n.toDecimalPlaces(4).toNumber();
}

/**
 * Amount of an expense that falls inside [start, end).
 *
 * - ONE_TIME: full amount if startsOn ∈ [start, end)
 * - DAILY:    amount × overlapping days
 * - WEEKLY:   amount / 7 × overlapping days
 * - MONTHLY:  amount × 12 / 365.25 × overlapping days (straight-line daily accrual)
 * - YEARLY:   amount / 365.25 × overlapping days
 *
 * Recurring expenses are accrued per day so that arbitrary periods compare
 * consistently; totals are rounded to minor units per period, not per day.
 */
export function expenseAmountInPeriod(expense: ExpenseInput, start: Date, end: Date): number {
  if (expense.recurrence === "ONE_TIME") {
    return expense.startsOn >= start && expense.startsOn < end ? expense.amountMinor : 0;
  }
  const effStart = expense.startsOn > start ? expense.startsOn : start;
  const hardEnd = expense.endsOn && expense.endsOn < end ? expense.endsOn : end;
  const days = Math.max(0, daysBetween(effStart, hardEnd));
  if (days === 0) return 0;
  const perDay = (() => {
    const a = new Decimal(expense.amountMinor);
    switch (expense.recurrence) {
      case "DAILY":
        return a;
      case "WEEKLY":
        return a.div(7);
      case "MONTHLY":
        return a.mul(12).div(365.25);
      case "YEARLY":
        return a.div(365.25);
    }
  })();
  return perDay.mul(days).toDecimalPlaces(0, Decimal.ROUND_HALF_EVEN).toNumber();
}

export interface AggregateInput {
  currency: string;
  periodStart: Date;
  periodEnd: Date;
  orders: OrderProfit[];
  adSpendMinor: number;
  expenses: ExpenseInput[];
}

export function summarizePeriod(input: AggregateInput): PeriodSummary {
  const included = input.orders.filter((o) => !o.isExcluded);
  const sumOf = (f: (o: OrderProfit) => number) => included.reduce((a, o) => a + f(o), 0);

  const grossSales = sumOf((o) => o.grossSalesMinor);
  const discounts = sumOf((o) => o.discountsMinor);
  const refunds = sumOf((o) => o.refundsMinor);
  const netSales = sumOf((o) => o.netSalesMinor);
  const taxCollected = sumOf((o) => o.taxCollectedMinor);
  const cogs = sumOf((o) => o.cogsMinor);
  const grossProfit = sumOf((o) => o.grossProfitMinor);
  const shippingRevenue = sumOf((o) => o.shippingRevenueMinor);
  const shippingCost = sumOf((o) => o.shippingCostMinor);
  const paymentFees = sumOf((o) => o.paymentFeesMinor);
  const contributionBeforeAds = sumOf((o) => o.contributionProfitMinor);
  const otherExpenses = input.expenses
    .filter((e) => e.currency.toUpperCase() === input.currency.toUpperCase())
    .reduce((a, e) => a + expenseAmountInPeriod(e, input.periodStart, input.periodEnd), 0);

  const contribution = contributionBeforeAds - input.adSpendMinor;
  const netProfit = contribution - otherExpenses;
  const orderCount = included.length;

  // Break-even ROAS: the ROAS at which contribution profit is zero.
  // contribution = netSales × (contributionBeforeAds / netSales) − adSpend = 0
  // ⇒ adSpend = contributionBeforeAds ⇒ ROAS_be = netSales / contributionBeforeAds.
  const breakEvenRoas = contributionBeforeAds > 0 ? round4(new Decimal(netSales).div(contributionBeforeAds)) : null;
  const roas = input.adSpendMinor > 0 ? round4(new Decimal(netSales).div(input.adSpendMinor)) : null;
  const breakEvenCpa = orderCount > 0 && contributionBeforeAds > 0 ? new Decimal(contributionBeforeAds).div(orderCount).toDecimalPlaces(0, Decimal.ROUND_DOWN).toNumber() : null;

  return {
    currency: input.currency.toUpperCase(),
    calcVersion: CALC_VERSION,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    orderCount,
    grossSalesMinor: grossSales,
    discountsMinor: discounts,
    refundsMinor: refunds,
    netSalesMinor: netSales,
    taxCollectedMinor: taxCollected,
    cogsMinor: cogs,
    grossProfitMinor: grossProfit,
    shippingRevenueMinor: shippingRevenue,
    shippingCostMinor: shippingCost,
    paymentFeesMinor: paymentFees,
    adSpendMinor: input.adSpendMinor,
    otherExpensesMinor: otherExpenses,
    contributionProfitMinor: contribution,
    netProfitMinor: netProfit,
    netMarginBps: bps(netProfit, netSales),
    grossMarginBps: bps(grossProfit, netSales),
    contributionMarginBps: bps(contribution, netSales),
    averageOrderValueMinor: orderCount > 0 ? Math.round(netSales / orderCount) : null,
    roas,
    breakEvenRoas,
    breakEvenCpaMinor: breakEvenCpa,
    refundRateBps: bps(refunds, grossSales - discounts),
    discountRateBps: bps(discounts, grossSales),
  };
}

/** Combine daily snapshots that were already summarized (used by the dashboard). */
export interface SnapshotLike {
  orderCount: number;
  grossSalesMinor: number;
  discountsMinor: number;
  refundsMinor: number;
  netSalesMinor: number;
  cogsMinor: number;
  grossProfitMinor: number;
  shippingRevenueMinor: number;
  shippingCostMinor: number;
  paymentFeesMinor: number;
  adSpendMinor: number;
  taxCollectedMinor: number;
  otherExpensesMinor: number;
  contributionProfitMinor: number;
  netProfitMinor: number;
}

export function combineSnapshots(currency: string, periodStart: Date, periodEnd: Date, snapshots: SnapshotLike[]): PeriodSummary {
  const s = (f: (x: SnapshotLike) => number) => snapshots.reduce((a, x) => a + f(x), 0);
  const netSales = s((x) => x.netSalesMinor);
  const contribution = s((x) => x.contributionProfitMinor);
  const adSpend = s((x) => x.adSpendMinor);
  const contributionBeforeAds = contribution + adSpend;
  const netProfit = s((x) => x.netProfitMinor);
  const orderCount = s((x) => x.orderCount);
  const grossSales = s((x) => x.grossSalesMinor);
  const discounts = s((x) => x.discountsMinor);
  const refunds = s((x) => x.refundsMinor);
  const grossProfit = s((x) => x.grossProfitMinor);
  return {
    currency,
    calcVersion: CALC_VERSION,
    periodStart,
    periodEnd,
    orderCount,
    grossSalesMinor: grossSales,
    discountsMinor: discounts,
    refundsMinor: refunds,
    netSalesMinor: netSales,
    taxCollectedMinor: s((x) => x.taxCollectedMinor),
    cogsMinor: s((x) => x.cogsMinor),
    grossProfitMinor: grossProfit,
    shippingRevenueMinor: s((x) => x.shippingRevenueMinor),
    shippingCostMinor: s((x) => x.shippingCostMinor),
    paymentFeesMinor: s((x) => x.paymentFeesMinor),
    adSpendMinor: adSpend,
    otherExpensesMinor: s((x) => x.otherExpensesMinor),
    contributionProfitMinor: contribution,
    netProfitMinor: netProfit,
    netMarginBps: bps(netProfit, netSales),
    grossMarginBps: bps(grossProfit, netSales),
    contributionMarginBps: bps(contribution, netSales),
    averageOrderValueMinor: orderCount > 0 ? Math.round(netSales / orderCount) : null,
    roas: adSpend > 0 ? round4(new Decimal(netSales).div(adSpend)) : null,
    breakEvenRoas: contributionBeforeAds > 0 ? round4(new Decimal(netSales).div(contributionBeforeAds)) : null,
    breakEvenCpaMinor: orderCount > 0 && contributionBeforeAds > 0 ? Math.floor(contributionBeforeAds / orderCount) : null,
    refundRateBps: bps(refunds, grossSales - discounts),
    discountRateBps: bps(discounts, grossSales),
  };
}
