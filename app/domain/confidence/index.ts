/**
 * Profit Confidence — a transparent data-completeness score (0-100).
 *
 * This is NOT a probability. It is a weighted checklist of the inputs the
 * profit calculation depends on, so a merchant can see *why* a number may be
 * unreliable. Weights and rules are documented in
 * docs/methodology/profit-confidence.md and must stay in sync with this file.
 */

export type IndicatorStatus = "ok" | "warning" | "missing";

export interface ConfidenceIndicator {
  key: string;
  label: string;
  status: IndicatorStatus;
  /** Points contributed out of `weight`. */
  points: number;
  weight: number;
  detail: string;
  /** Route in the app where the merchant can fix the issue. */
  actionHref?: string;
}

export interface ConfidenceResult {
  score: number;
  indicators: ConfidenceIndicator[];
  computedAt: string;
}

export interface ConfidenceInput {
  ordersSynced: boolean;
  /** Minutes since last successful order sync (null = never). */
  orderSyncAgeMinutes: number | null;
  refundsSynced: boolean;
  transactionsSynced: boolean;
  /** 0-100 share of sold units in the period with known COGS. */
  cogsCoveragePct: number;
  productsMissingCogs: number;
  /** Orders in the period without an actual or rule-based shipping cost. */
  ordersWithoutShippingCost: number;
  orderCount: number;
  /** Share (0-100) of payment fees that are actual rather than estimated. */
  paymentFeeActualPct: number;
  feeConfigConfirmed: boolean;
  adAccountsConnected: number;
  /** Ad accounts whose last sync is older than 36h or in error. */
  adAccountsStale: number;
  taxConfigured: boolean;
  hasExpenses: boolean;
}

const WEIGHTS = {
  orders: 25,
  refunds: 10,
  cogs: 25,
  shipping: 10,
  fees: 10,
  ads: 10,
  tax: 5,
  freshness: 5,
} as const;

function clampPoints(weight: number, fraction: number): number {
  return Math.max(0, Math.min(weight, Math.round(weight * fraction)));
}

export function computeConfidence(input: ConfidenceInput, now = new Date()): ConfidenceResult {
  const indicators: ConfidenceIndicator[] = [];

  indicators.push({
    key: "orders",
    label: "Shopify orders synchronized",
    weight: WEIGHTS.orders,
    points: input.ordersSynced ? WEIGHTS.orders : 0,
    status: input.ordersSynced ? "ok" : "missing",
    detail: input.ordersSynced ? "Order, discount and line-item data is available." : "Orders have not finished synchronizing.",
    actionHref: "/app/data-health",
  });

  indicators.push({
    key: "refunds",
    label: "Refunds and transactions synchronized",
    weight: WEIGHTS.refunds,
    points: input.refundsSynced && input.transactionsSynced ? WEIGHTS.refunds : input.refundsSynced || input.transactionsSynced ? WEIGHTS.refunds / 2 : 0,
    status: input.refundsSynced && input.transactionsSynced ? "ok" : "warning",
    detail: input.refundsSynced && input.transactionsSynced ? "Refunds and payment transactions are included." : "Some refund or payment data is not yet available.",
    actionHref: "/app/data-health",
  });

  const cogsFraction = input.cogsCoveragePct / 100;
  indicators.push({
    key: "cogs",
    label: `COGS ${input.cogsCoveragePct}% complete`,
    weight: WEIGHTS.cogs,
    points: clampPoints(WEIGHTS.cogs, cogsFraction),
    status: input.cogsCoveragePct >= 95 ? "ok" : input.cogsCoveragePct >= 60 ? "warning" : "missing",
    detail:
      input.productsMissingCogs === 0
        ? "Every sold variant has a cost."
        : `${input.productsMissingCogs} product${input.productsMissingCogs === 1 ? "" : "s"} missing COGS — their cost is treated as 0, so profit is overstated.`,
    actionHref: "/app/cogs?filter=missing",
  });

  const shippingCovered = input.orderCount === 0 ? 1 : 1 - input.ordersWithoutShippingCost / input.orderCount;
  indicators.push({
    key: "shipping",
    label: "Shipping costs available",
    weight: WEIGHTS.shipping,
    points: clampPoints(WEIGHTS.shipping, shippingCovered),
    status: input.ordersWithoutShippingCost === 0 ? "ok" : shippingCovered > 0.7 ? "warning" : "missing",
    detail:
      input.ordersWithoutShippingCost === 0
        ? "Shipping cost is known or estimated for all orders."
        : `Shipping cost unavailable for ${input.ordersWithoutShippingCost} order${input.ordersWithoutShippingCost === 1 ? "" : "s"}. Add a shipping cost rule to estimate it.`,
    actionHref: "/app/settings/shipping",
  });

  const feeFraction = input.paymentFeeActualPct >= 100 ? 1 : input.feeConfigConfirmed ? 0.8 : 0.4;
  indicators.push({
    key: "fees",
    label: "Payment fees",
    weight: WEIGHTS.fees,
    points: clampPoints(WEIGHTS.fees, feeFraction),
    status: feeFraction === 1 ? "ok" : input.feeConfigConfirmed ? "ok" : "warning",
    detail:
      input.paymentFeeActualPct >= 100
        ? "Actual processor fees are available for all charges."
        : input.feeConfigConfirmed
          ? `${input.paymentFeeActualPct}% of fees are actual; the rest use your configured fee rate.`
          : "Fees are estimated with default rates. Confirm your processor rates in Settings.",
    actionHref: "/app/settings/fees",
  });

  const adsFraction = input.adAccountsConnected === 0 ? 0.5 : 1 - input.adAccountsStale / input.adAccountsConnected;
  indicators.push({
    key: "ads",
    label: "Advertising spend synchronized",
    weight: WEIGHTS.ads,
    points: clampPoints(WEIGHTS.ads, adsFraction),
    status: input.adAccountsConnected === 0 ? "warning" : input.adAccountsStale === 0 ? "ok" : "warning",
    detail:
      input.adAccountsConnected === 0
        ? "No advertising accounts connected. If you run ads, profit is overstated."
        : input.adAccountsStale === 0
          ? "All ad accounts are fresh."
          : `${input.adAccountsStale} ad account${input.adAccountsStale === 1 ? "" : "s"} stale or in error.`,
    actionHref: "/app/integrations",
  });

  indicators.push({
    key: "tax",
    label: "Tax treatment configured",
    weight: WEIGHTS.tax,
    points: input.taxConfigured ? WEIGHTS.tax : 0,
    status: input.taxConfigured ? "ok" : "warning",
    detail: input.taxConfigured ? "Collected tax is treated per your configuration." : "Tax treatment not confirmed; collected tax is excluded from revenue by default.",
    actionHref: "/app/settings/tax",
  });

  const age = input.orderSyncAgeMinutes;
  const freshFraction = age === null ? 0 : age <= 60 ? 1 : age <= 24 * 60 ? 0.6 : 0;
  indicators.push({
    key: "freshness",
    label: "Data freshness",
    weight: WEIGHTS.freshness,
    points: clampPoints(WEIGHTS.freshness, freshFraction),
    status: freshFraction === 1 ? "ok" : freshFraction > 0 ? "warning" : "missing",
    detail: age === null ? "No sync recorded yet." : age <= 60 ? "Synced within the last hour." : `Last order sync ${Math.round(age / 60)}h ago.`,
    actionHref: "/app/data-health",
  });

  const score = indicators.reduce((a, i) => a + i.points, 0);
  return { score: Math.max(0, Math.min(100, score)), indicators, computedAt: now.toISOString() };
}

export function confidenceLabel(score: number): "High" | "Moderate" | "Low" {
  if (score >= 85) return "High";
  if (score >= 60) return "Moderate";
  return "Low";
}
