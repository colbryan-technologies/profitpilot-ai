import { requireReportPeriod, includesPeriod } from "../report-access.server";
import { reportReadiness } from "../report-readiness.server";
import prisma from "../../db.server";
import { CALC_VERSION, type PeriodSummary } from "../../domain/profit/types";
import { confidenceLabel } from "../../domain/confidence";
import { costDrivers } from "../../domain/leaks";
import {
  previousPeriod,
  resolvePeriod,
  type Period,
  type PeriodKey,
} from "../../lib/dates";
import { formatMoney, percentChange } from "../../lib/money";
import { periodSummary, productMetrics } from "../profit/reporting.server";

/**
 * Grounding pack: the only merchant data the model sees. Everything here is
 * produced by deterministic code, pre-formatted, and small enough to fit in a
 * prompt. No customer identifiers, emails, addresses, or order-level PII.
 */
export interface GroundingPack {
  calcVersion: string;
  currency: string;
  timeZone: string;
  period: { key: PeriodKey; start: string; end: string };
  comparison: { start: string; end: string };
  metrics: Record<string, string | number | null>;
  deltas: Record<
    string,
    { current: string; previous: string; changePct: number | null }
  >;
  drivers: string[];
  confidence: { score: number; label: string; caveats: string[] };
  topProducts: Array<{
    title: string;
    netSales: string;
    contributionProfit: string;
    marginPct: number | null;
    missingCogs: boolean;
  }>;
  worstProducts: Array<{
    title: string;
    netSales: string;
    contributionProfit: string;
    marginPct: number | null;
    missingCogs: boolean;
  }>;
  openLeaks: Array<{
    type: string;
    severity: string;
    title: string;
    impact: string | null;
  }>;
  dataNotes: string[];
  /** Every number the model may cite, for post-hoc validation. */
  allowedNumbers: string[];
}

function marginPct(profit: number, sales: number): number | null {
  if (sales <= 0) return null;
  return Math.round((profit / sales) * 1000) / 10;
}

export async function buildGrounding(
  storeId: string,
  periodKey: PeriodKey = "30d",
  custom?: { start: string; end: string },
): Promise<GroundingPack> {
  const store = await prisma.store.findUniqueOrThrow({
    where: { id: storeId },
    select: { currency: true, ianaTimezone: true },
  });
  const cur: Period = resolvePeriod(
    periodKey,
    store.ianaTimezone,
    new Date(),
    custom,
  );
  const window = await requireReportPeriod(storeId, cur);
  const prev = previousPeriod(cur);
  const comparisonAvailable =
    includesPeriod(window, prev) &&
    (await reportReadiness(storeId, prev)).ready;
  const fmt = (m: number) => formatMoney(m, store.currency);

  const [
    curSum,
    prevSum,
    products,
    leaks,
    latestSnapshot,
    missingCogsCount,
    adAccounts,
    tax,
    fee,
  ] = await Promise.all([
    periodSummary(storeId, cur),
    comparisonAvailable ? periodSummary(storeId, prev) : Promise.resolve(null),
    productMetrics(storeId, cur),
    prisma.profitLeak.findMany({
      where: {
        storeId,
        status: "OPEN",
        periodStart: { gte: new Date(window.start.getTime() + 7 * 86_400_000) },
      },
      orderBy: [{ severity: "asc" }, { impactMinor: "desc" }],
      take: 8,
    }),
    prisma.profitSnapshot.findFirst({
      where: { storeId, date: { gte: cur.start, lt: cur.end } },
      orderBy: { date: "desc" },
    }),
    prisma.variant.count({
      where: {
        storeId,
        deletedAt: null,
        cogs: { none: {} },
        shopifyUnitCostMinor: null,
        lineItems: { some: { order: { processedAt: { gte: cur.start } } } },
      },
    }),
    prisma.adAccount.count({
      where: { storeId, status: { not: "DISCONNECTED" } },
    }),
    prisma.taxConfig.findUnique({ where: { storeId } }),
    prisma.feeConfig.findUnique({ where: { storeId } }),
  ]);

  const numbers = new Set<string>();
  const money = (m: number) => {
    const s = fmt(m);
    numbers.add(s);
    return s;
  };
  const num = (n: number | null) => {
    if (n !== null) numbers.add(String(n));
    return n;
  };

  const deltaFor = (label: string, pick: (s: PeriodSummary) => number) => {
    const c = pick(curSum);
    if (!prevSum)
      return [
        label,
        {
          current: money(c),
          previous: "Unavailable: history or data readiness",
          changePct: null,
        },
      ] as const;
    const p = pick(prevSum);
    return [
      label,
      {
        current: money(c),
        previous: money(p),
        changePct: num(percentChange(c, p)),
      },
    ] as const;
  };

  const deltas = Object.fromEntries([
    deltaFor("netSales", (s) => s.netSalesMinor),
    deltaFor("netProfit", (s) => s.netProfitMinor),
    deltaFor("contributionProfit", (s) => s.contributionProfitMinor),
    deltaFor("cogs", (s) => s.cogsMinor),
    deltaFor("adSpend", (s) => s.adSpendMinor),
    deltaFor("refunds", (s) => s.refundsMinor),
    deltaFor("discounts", (s) => s.discountsMinor),
    deltaFor("shippingCost", (s) => s.shippingCostMinor),
    deltaFor("paymentFees", (s) => s.paymentFeesMinor),
    deltaFor("otherExpenses", (s) => s.otherExpensesMinor),
  ]);

  const metrics: GroundingPack["metrics"] = {
    orders: num(curSum.orderCount),
    grossSales: money(curSum.grossSalesMinor),
    netSales: money(curSum.netSalesMinor),
    grossProfit: money(curSum.grossProfitMinor),
    contributionProfit: money(curSum.contributionProfitMinor),
    netProfit: money(curSum.netProfitMinor),
    netMarginPct: num(
      curSum.netMarginBps === null ? null : curSum.netMarginBps / 100,
    ),
    grossMarginPct: num(
      curSum.grossMarginBps === null ? null : curSum.grossMarginBps / 100,
    ),
    averageOrderValue:
      curSum.averageOrderValueMinor === null
        ? null
        : money(curSum.averageOrderValueMinor),
    roas: num(curSum.roas),
    breakEvenRoas: num(curSum.breakEvenRoas),
    breakEvenCpa:
      curSum.breakEvenCpaMinor === null
        ? null
        : money(curSum.breakEvenCpaMinor),
    refundRatePct: num(
      curSum.refundRateBps === null ? null : curSum.refundRateBps / 100,
    ),
    discountRatePct: num(
      curSum.discountRateBps === null ? null : curSum.discountRateBps / 100,
    ),
    shippingRevenue: money(curSum.shippingRevenueMinor),
    taxCollected: money(curSum.taxCollectedMinor),
  };

  const confidence = latestSnapshot
    ? (latestSnapshot.confidenceJson as {
        score: number;
        indicators?: Array<{ label: string; status: string; detail?: string }>;
      })
    : null;
  const caveats = (confidence?.indicators ?? [])
    .filter((i) => i.status !== "ok")
    .map((i) => i.detail ?? i.label);

  const withMargin = products.map((p) => ({
    title: p.title,
    netSales: money(p.netSalesMinor),
    contributionProfit: money(p.contributionProfitMinor),
    marginPct: num(marginPct(p.contributionProfitMinor, p.netSalesMinor)),
    missingCogs: p.missingCogs,
  }));
  const byProfit = [...products].sort(
    (a, b) => a.contributionProfitMinor - b.contributionProfitMinor,
  );

  const dataNotes: string[] = (await reportReadiness(storeId, cur)).warnings;
  if (!comparisonAvailable)
    dataNotes.push(
      "Previous-period figures are outside plan history or not ready; no comparison was calculated.",
    );
  if (missingCogsCount > 0)
    dataNotes.push(
      `${missingCogsCount} sold variant(s) have no cost (COGS) recorded; profit for them is overstated.`,
    );
  if (adAccounts === 0)
    dataNotes.push(
      "No advertising account is connected; ad spend is not included in profit unless entered manually.",
    );
  if (!tax || tax.treatment === "UNCONFIGURED")
    dataNotes.push(
      "Tax treatment has not been confirmed; collected tax is excluded from revenue by default.",
    );
  if (!fee?.confirmedAt)
    dataNotes.push(
      "Payment fee assumptions have not been confirmed by the merchant; fees may be estimated.",
    );
  if (curSum.orderCount === 0) dataNotes.push("No orders in this period.");
  dataNotes.push(
    "Advertising figures are platform-reported spend. Platform-attributed revenue is not used for profit.",
  );
  dataNotes.push(
    "Comparisons describe association between periods, not proven causation.",
  );

  return {
    calcVersion: CALC_VERSION,
    currency: store.currency,
    timeZone: store.ianaTimezone,
    period: {
      key: periodKey,
      start: cur.start.toISOString().slice(0, 10),
      end: cur.end.toISOString().slice(0, 10),
    },
    comparison: {
      start: prev.start.toISOString().slice(0, 10),
      end: prev.end.toISOString().slice(0, 10),
    },
    metrics,
    deltas,
    drivers: prevSum
      ? costDrivers(curSum, prevSum, money)
          .slice(0, 5)
          .map((d) => d.text)
      : [],
    confidence: {
      score: confidence?.score ?? 0,
      label: confidence ? confidenceLabel(confidence.score) : "Low",
      caveats,
    },
    topProducts: withMargin.slice(0, 5),
    worstProducts: byProfit
      .slice(0, 5)
      .map((p) => withMargin.find((w) => w.title === p.title)!)
      .filter(Boolean),
    openLeaks: leaks.map((l) => ({
      type: l.type,
      severity: l.severity,
      title: l.title,
      impact: l.impactMinor === null ? null : money(l.impactMinor),
    })),
    dataNotes,
    allowedNumbers: [...numbers],
  };
}
