import type { CalculationContext, LineItemInput, OrderInput } from "../../app/domain/profit/types";
import { HistoryCogsResolver } from "../../app/domain/profit/cogs";

export const D = (s: string) => new Date(s);

export function line(overrides: Partial<LineItemInput> & { id: string }): LineItemInput {
  return {
    variantId: "v1",
    productId: "p1",
    title: "Premium Hoodie",
    sku: "HOOD-1",
    quantity: 1,
    currentQuantity: overrides.quantity ?? 1,
    unitPriceMinor: 5000,
    discountMinor: 0,
    taxMinor: 0,
    requiresShipping: true,
    isGiftCard: false,
    ...overrides,
  };
}

export function order(overrides: Partial<OrderInput> = {}): OrderInput {
  const lines = overrides.lineItems ?? [line({ id: "l1", quantity: 2, unitPriceMinor: 5000 })];
  const subtotal = lines.reduce((a, l) => a + l.unitPriceMinor * l.quantity, 0);
  const discounts = overrides.totalDiscountsMinor ?? lines.reduce((a, l) => a + l.discountMinor, 0);
  const shipping = overrides.totalShippingMinor ?? 500;
  const tax = overrides.totalTaxMinor ?? lines.reduce((a, l) => a + l.taxMinor, 0);
  const total = subtotal - discounts + shipping + (overrides.taxesIncluded ? 0 : tax);
  return {
    id: "o1",
    name: "#1001",
    processedAt: D("2026-05-10T12:00:00Z"),
    cancelledAt: null,
    currency: "EUR",
    taxesIncluded: false,
    isTest: false,
    subtotalMinor: subtotal,
    totalDiscountsMinor: discounts,
    totalShippingMinor: shipping,
    totalTaxMinor: tax,
    totalTipMinor: 0,
    totalDutiesMinor: 0,
    totalPriceMinor: overrides.totalPriceMinor ?? total,
    shippingCountryCode: "IE",
    lineItems: lines,
    refunds: [],
    transactions: [{ id: "t1", kind: "SALE", status: "SUCCESS", gateway: "shopify_payments", amountMinor: overrides.totalPriceMinor ?? total, feeMinor: null }],
    actualShippingCostMinor: null,
    ...overrides,
  };
}

export function ctx(overrides: Partial<CalculationContext> = {}): CalculationContext {
  return {
    currency: "EUR",
    taxTreatment: "EXCLUDE_COLLECTED_TAX",
    fees: { percentBps: 290, fixedMinor: 30, gatewayOverrides: { paypal: { percentBps: 349, fixedMinor: 35 } } },
    shippingRules: [{ countryCode: null, flatMinor: 400, perItemMinor: 0, percentBps: 0, priority: 0 }],
    cogs: new HistoryCogsResolver([
      { variantId: "v1", unitCostMinor: 900, currency: "EUR", effectiveFrom: D("2026-01-01T00:00:00Z") },
      { variantId: "v1", unitCostMinor: 1050, currency: "EUR", effectiveFrom: D("2026-04-01T00:00:00Z") },
      { variantId: "v1", unitCostMinor: 1100, currency: "EUR", effectiveFrom: D("2026-07-01T00:00:00Z") },
      { variantId: "v2", unitCostMinor: 2000, currency: "EUR", effectiveFrom: D("2025-01-01T00:00:00Z") },
    ]),
    ...overrides,
  };
}
