import { allocate, assertInteger, percentBps, ratio } from "../../lib/money";
import type { CalculationContext, LineProfit, OrderInput, OrderProfit, ShippingRuleInput, TransactionInput } from "./types";
import { CALC_VERSION } from "./types";

function bps(numerator: number, denominator: number): number | null {
  const r = ratio(numerator, denominator);
  return r === null ? null : Math.round(r * 10_000);
}

function pickShippingRule(rules: ShippingRuleInput[], countryCode: string | null): ShippingRuleInput | null {
  if (rules.length === 0) return null;
  const sorted = [...rules].sort((a, b) => b.priority - a.priority);
  const specific = countryCode ? sorted.find((r) => r.countryCode?.toUpperCase() === countryCode.toUpperCase()) : undefined;
  return specific ?? sorted.find((r) => r.countryCode === null) ?? null;
}

function estimateShippingCost(order: OrderInput, ctx: CalculationContext, shippableUnits: number, shippingRevenueMinor: number) {
  if (order.actualShippingCostMinor !== null) {
    return { cost: order.actualShippingCostMinor, source: "ACTUAL" as const };
  }
  if (shippableUnits === 0) return { cost: 0, source: "ACTUAL" as const };
  const rule = pickShippingRule(ctx.shippingRules, order.shippingCountryCode);
  if (!rule) return { cost: 0, source: "UNKNOWN" as const };
  const cost = rule.flatMinor + rule.perItemMinor * shippableUnits + percentBps(shippingRevenueMinor, rule.percentBps);
  return { cost, source: "RULE" as const };
}

function isChargeTransaction(t: TransactionInput): boolean {
  return (t.kind === "SALE" || t.kind === "CAPTURE") && t.status === "SUCCESS";
}

function computePaymentFees(order: OrderInput, ctx: CalculationContext) {
  const charges = order.transactions.filter(isChargeTransaction);
  if (charges.length === 0) {
    return { fees: 0, source: "NONE" as const };
  }
  let actual = 0;
  let estimated = 0;
  let actualCount = 0;
  for (const t of charges) {
    if (t.feeMinor !== null) {
      actual += t.feeMinor;
      actualCount++;
    } else {
      const override = t.gateway ? ctx.fees.gatewayOverrides[t.gateway.toLowerCase()] : undefined;
      const cfg = override ?? ctx.fees;
      // Manual / gift-card / free gateways carry no processor fee.
      if (t.gateway && /^(manual|gift_card|bogus|cash|free)/i.test(t.gateway)) continue;
      estimated += percentBps(t.amountMinor, cfg.percentBps) + cfg.fixedMinor;
    }
  }
  const source = actualCount === charges.length ? "ACTUAL" : actualCount === 0 ? "ESTIMATED" : "MIXED";
  return { fees: actual + estimated, source: source as "ACTUAL" | "ESTIMATED" | "MIXED" };
}

/**
 * Compute a single order's profitability.
 *
 * Rules (see docs/methodology/profit-calculation.md):
 *  gross sales    = Σ unitPrice × quantity                 (tax-inclusive if the shop is)
 *  discounts      = Σ line discount allocations
 *  refunds        = Σ refunded line subtotals              (product portion only)
 *  tax collected  = Σ line tax − refunded tax
 *  net sales      = gross − discounts − refunds − (tax if included in prices and treatment excludes tax)
 *  COGS           = Σ unitCogs × (quantity − restocked refunded units)
 *  gross profit   = net sales − COGS
 *  shipping rev.  = shipping charged − shipping refunded
 *  contribution   = gross profit + shipping revenue − shipping cost − payment fees + tips − duties
 *
 * Ad spend and operating expenses are store-level and are added in `aggregate.ts`.
 */
export function computeOrderProfit(order: OrderInput, ctx: CalculationContext): OrderProfit {
  const currency = order.currency.toUpperCase();
  const excludedReason = order.isTest ? "test order" : order.cancelledAt && order.transactions.every((t) => !isChargeTransaction(t)) ? "cancelled before payment" : null;

  const refundedByLine = new Map<string, { qty: number; restockedQty: number; subtotal: number; tax: number }>();
  let shippingRefund = 0;
  let taxRefundTotal = 0;
  for (const r of order.refunds) {
    shippingRefund += r.shippingRefundMinor;
    taxRefundTotal += r.taxRefundMinor;
    for (const rl of r.lineItems) {
      const cur = refundedByLine.get(rl.lineItemId) ?? { qty: 0, restockedQty: 0, subtotal: 0, tax: 0 };
      cur.qty += rl.quantity;
      if (rl.restockType !== "NO_RESTOCK") cur.restockedQty += rl.quantity;
      cur.subtotal += rl.subtotalMinor;
      cur.tax += rl.taxMinor;
      refundedByLine.set(rl.lineItemId, cur);
    }
  }

  const lines: LineProfit[] = [];
  let shippableUnits = 0;
  let missingCogsLineCount = 0;
  let cogsQtyTotal = 0;
  let cogsQtyKnown = 0;

  for (const li of order.lineItems) {
    assertInteger(li.unitPriceMinor, `line ${li.id} unitPrice`);
    const refunded = refundedByLine.get(li.id) ?? { qty: 0, restockedQty: 0, subtotal: 0, tax: 0 };
    const gross = li.unitPriceMinor * li.quantity;
    const netQuantity = Math.max(0, li.quantity - refunded.qty);
    const cogsQuantity = Math.max(0, li.quantity - refunded.restockedQty);
    const tax = li.taxMinor - refunded.tax;
    const taxDeduction = order.taxesIncluded && ctx.taxTreatment !== "INCLUDE_TAX_AS_REVENUE" ? tax : 0;
    const netSales = gross - li.discountMinor - refunded.subtotal - taxDeduction;

    let unitCogs: number | null = null;
    let cogsSource: LineProfit["cogsSource"] = "MISSING";
    if (li.isGiftCard) {
      unitCogs = 0;
      cogsSource = "CURRENT";
    } else {
      const resolved = ctx.cogs.resolve(li.variantId, order.processedAt);
      if (resolved) {
        unitCogs = resolved.unitCostMinor;
        cogsSource = resolved.source;
      }
    }
    const cogs = unitCogs === null ? 0 : unitCogs * cogsQuantity;
    if (unitCogs === null && cogsQuantity > 0) missingCogsLineCount++;
    cogsQtyTotal += cogsQuantity;
    if (unitCogs !== null) cogsQtyKnown += cogsQuantity;
    if (li.requiresShipping) shippableUnits += netQuantity;

    lines.push({
      lineItemId: li.id,
      variantId: li.variantId,
      productId: li.productId,
      title: li.title,
      sku: li.sku,
      quantity: li.quantity,
      netQuantity,
      cogsQuantity,
      grossSalesMinor: gross,
      discountMinor: li.discountMinor,
      refundMinor: refunded.subtotal,
      taxMinor: tax,
      netSalesMinor: netSales,
      unitCogsMinor: unitCogs,
      cogsMinor: cogs,
      cogsSource,
      grossProfitMinor: netSales - cogs,
    });
  }

  const grossSales = lines.reduce((a, l) => a + l.grossSalesMinor, 0);
  const discounts = lines.reduce((a, l) => a + l.discountMinor, 0);
  const refunds = lines.reduce((a, l) => a + l.refundMinor, 0);
  // Shipping tax is whatever remains of order tax after line tax.
  const shippingTax = Math.max(0, order.totalTaxMinor - order.lineItems.reduce((a, l) => a + l.taxMinor, 0));
  const taxCollected = order.totalTaxMinor - taxRefundTotal;
  const netSales = lines.reduce((a, l) => a + l.netSalesMinor, 0);
  const cogs = lines.reduce((a, l) => a + l.cogsMinor, 0);
  const grossProfit = netSales - cogs;

  const shippingRevenue = order.totalShippingMinor - shippingRefund - (order.taxesIncluded && ctx.taxTreatment !== "INCLUDE_TAX_AS_REVENUE" ? shippingTax : 0);
  const shipping = estimateShippingCost(order, ctx, shippableUnits, shippingRevenue);
  const fees = computePaymentFees(order, ctx);

  const contribution = excludedReason ? 0 : grossProfit + shippingRevenue - shipping.cost - fees.fees + order.totalTipMinor - order.totalDutiesMinor;
  const coverage = cogsQtyTotal === 0 ? 100 : Math.round((cogsQtyKnown / cogsQtyTotal) * 100);

  if (excludedReason) {
    return {
      orderId: order.id,
      currency,
      calcVersion: CALC_VERSION,
      isExcluded: true,
      excludedReason,
      grossSalesMinor: 0,
      discountsMinor: 0,
      refundsMinor: 0,
      taxCollectedMinor: 0,
      netSalesMinor: 0,
      cogsMinor: 0,
      cogsCoverage: 100,
      missingCogsLineCount: 0,
      grossProfitMinor: 0,
      shippingRevenueMinor: 0,
      shippingCostMinor: 0,
      shippingCostSource: "ACTUAL",
      paymentFeesMinor: 0,
      paymentFeeSource: "NONE",
      tipsMinor: 0,
      dutiesMinor: 0,
      contributionProfitMinor: 0,
      contributionMarginBps: null,
      lines: [],
    };
  }

  return {
    orderId: order.id,
    currency,
    calcVersion: CALC_VERSION,
    isExcluded: false,
    excludedReason: null,
    grossSalesMinor: grossSales,
    discountsMinor: discounts,
    refundsMinor: refunds,
    taxCollectedMinor: taxCollected,
    netSalesMinor: netSales,
    cogsMinor: cogs,
    cogsCoverage: coverage,
    missingCogsLineCount,
    grossProfitMinor: grossProfit,
    shippingRevenueMinor: shippingRevenue,
    shippingCostMinor: shipping.cost,
    shippingCostSource: shipping.source,
    paymentFeesMinor: fees.fees,
    paymentFeeSource: fees.source,
    tipsMinor: order.totalTipMinor,
    dutiesMinor: order.totalDutiesMinor,
    contributionProfitMinor: contribution,
    contributionMarginBps: bps(contribution, netSales),
    lines,
  };
}

/** Split an order-level amount (fees, shipping cost) across lines by net sales weight. */
export function allocateAcrossLines(amount: number, lines: LineProfit[]): number[] {
  return allocate(
    amount,
    lines.map((l) => Math.max(0, l.netSalesMinor)),
  );
}
