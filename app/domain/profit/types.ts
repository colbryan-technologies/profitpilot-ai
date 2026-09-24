/**
 * Input/output types for the deterministic profit engine.
 * Everything here is plain data — no Prisma, no I/O — so it can be tested
 * exhaustively with fixtures. See docs/methodology/profit-calculation.md.
 */

export const CALC_VERSION = "2026.09.1";

export type TaxTreatment = "EXCLUDE_COLLECTED_TAX" | "INCLUDE_TAX_AS_REVENUE" | "UNCONFIGURED";

export type CogsSourceKind = "HISTORY" | "CURRENT" | "SHOPIFY" | "MISSING";

export interface LineItemInput {
  id: string;
  variantId: string | null;
  productId: string | null;
  title: string;
  sku: string | null;
  quantity: number;
  /** Quantity remaining after removals/refunds (Shopify `currentQuantity`). */
  currentQuantity: number;
  unitPriceMinor: number;
  /** Total discount allocated to the whole line (all quantities). */
  discountMinor: number;
  /** Total tax on the line. */
  taxMinor: number;
  requiresShipping: boolean;
  isGiftCard: boolean;
}

export interface RefundLineInput {
  lineItemId: string;
  quantity: number;
  /** Pre-tax subtotal refunded for these units (positive). */
  subtotalMinor: number;
  taxMinor: number;
  restockType: "NO_RESTOCK" | "CANCEL" | "RETURN" | "LEGACY_RESTOCK";
}

export interface RefundInput {
  id: string;
  processedAt: Date;
  /** Total money returned to the customer (positive). */
  totalRefundedMinor: number;
  shippingRefundMinor: number;
  taxRefundMinor: number;
  lineItems: RefundLineInput[];
}

export interface TransactionInput {
  id: string;
  kind: "SALE" | "CAPTURE" | "REFUND" | "AUTHORIZATION" | "VOID" | string;
  status: "SUCCESS" | "FAILURE" | "PENDING" | "ERROR" | string;
  gateway: string | null;
  amountMinor: number;
  /** Actual processor fee if Shopify exposes it (Shopify Payments). */
  feeMinor: number | null;
}

export interface OrderInput {
  id: string;
  name: string;
  processedAt: Date;
  cancelledAt: Date | null;
  currency: string;
  taxesIncluded: boolean;
  isTest: boolean;
  subtotalMinor: number;
  totalDiscountsMinor: number;
  totalShippingMinor: number;
  totalTaxMinor: number;
  totalTipMinor: number;
  totalDutiesMinor: number;
  totalPriceMinor: number;
  shippingCountryCode: string | null;
  lineItems: LineItemInput[];
  refunds: RefundInput[];
  transactions: TransactionInput[];
  /** Actual carrier/fulfillment cost if known (e.g. from a fulfillment app). */
  actualShippingCostMinor: number | null;
}

export interface CogsRecord {
  unitCostMinor: number;
  currency: string;
  effectiveFrom: Date;
}

/** Resolves COGS for a variant at a point in time. Implemented over CogsHistory. */
export interface CogsResolver {
  resolve(variantId: string | null, at: Date): { unitCostMinor: number; source: CogsSourceKind } | null;
}

export interface FeeConfigInput {
  percentBps: number;
  fixedMinor: number;
  gatewayOverrides: Record<string, { percentBps: number; fixedMinor: number }>;
}

export interface ShippingRuleInput {
  countryCode: string | null;
  flatMinor: number;
  perItemMinor: number;
  percentBps: number;
  priority: number;
}

export interface CalculationContext {
  currency: string;
  taxTreatment: TaxTreatment;
  fees: FeeConfigInput;
  shippingRules: ShippingRuleInput[];
  cogs: CogsResolver;
}

export interface LineProfit {
  lineItemId: string;
  variantId: string | null;
  productId: string | null;
  title: string;
  sku: string | null;
  quantity: number;
  /** Units that count toward sales after refunds. */
  netQuantity: number;
  /** Units for which COGS is charged (refunded-and-restocked units are excluded). */
  cogsQuantity: number;
  grossSalesMinor: number;
  discountMinor: number;
  refundMinor: number;
  taxMinor: number;
  netSalesMinor: number;
  unitCogsMinor: number | null;
  cogsMinor: number;
  cogsSource: CogsSourceKind;
  grossProfitMinor: number;
}

export interface OrderProfit {
  orderId: string;
  currency: string;
  calcVersion: string;
  isExcluded: boolean;
  excludedReason: string | null;
  grossSalesMinor: number;
  discountsMinor: number;
  refundsMinor: number;
  taxCollectedMinor: number;
  netSalesMinor: number;
  cogsMinor: number;
  /** 0-100 share of cogsQuantity with a known cost. */
  cogsCoverage: number;
  missingCogsLineCount: number;
  grossProfitMinor: number;
  shippingRevenueMinor: number;
  shippingCostMinor: number;
  shippingCostSource: "ACTUAL" | "RULE" | "UNKNOWN";
  paymentFeesMinor: number;
  paymentFeeSource: "ACTUAL" | "ESTIMATED" | "MIXED" | "NONE";
  tipsMinor: number;
  dutiesMinor: number;
  contributionProfitMinor: number;
  contributionMarginBps: number | null;
  lines: LineProfit[];
}

export interface ExpenseInput {
  id: string;
  amountMinor: number;
  currency: string;
  recurrence: "ONE_TIME" | "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  startsOn: Date;
  endsOn: Date | null;
}

export interface PeriodSummary {
  currency: string;
  calcVersion: string;
  periodStart: Date;
  periodEnd: Date;
  orderCount: number;
  grossSalesMinor: number;
  discountsMinor: number;
  refundsMinor: number;
  netSalesMinor: number;
  taxCollectedMinor: number;
  cogsMinor: number;
  grossProfitMinor: number;
  shippingRevenueMinor: number;
  shippingCostMinor: number;
  paymentFeesMinor: number;
  adSpendMinor: number;
  otherExpensesMinor: number;
  contributionProfitMinor: number;
  netProfitMinor: number;
  /** netProfit / netSales, basis points. */
  netMarginBps: number | null;
  grossMarginBps: number | null;
  contributionMarginBps: number | null;
  averageOrderValueMinor: number | null;
  /** netSales / adSpend, 4 dp. */
  roas: number | null;
  /** Ad spend level at which contribution profit reaches zero: netSales / (netSales - contributionProfitBeforeAds). */
  breakEvenRoas: number | null;
  /** Max acquisition cost per order before the average order becomes unprofitable. */
  breakEvenCpaMinor: number | null;
  refundRateBps: number | null;
  discountRateBps: number | null;
}
