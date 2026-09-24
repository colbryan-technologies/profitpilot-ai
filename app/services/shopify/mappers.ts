import { z } from "zod";
import { toMinor } from "../../lib/money";

const money = z.object({ amount: z.string(), currencyCode: z.string() });
const moneyBag = z.object({ shopMoney: money });

const lineItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  sku: z.string().nullable(),
  quantity: z.number().int(),
  currentQuantity: z.number().int(),
  requiresShipping: z.boolean(),
  isGiftCard: z.boolean(),
  product: z.object({ id: z.string() }).nullable(),
  variant: z.object({ id: z.string() }).nullable(),
  originalUnitPriceSet: moneyBag,
  totalDiscountSet: moneyBag,
  taxLines: z.array(z.object({ priceSet: moneyBag })),
});

const refundSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  totalRefundedSet: moneyBag,
  refundLineItems: z.object({
    nodes: z.array(
      z.object({
        quantity: z.number().int(),
        restockType: z.string(),
        lineItem: z.object({ id: z.string() }),
        subtotalSet: moneyBag,
        totalTaxSet: moneyBag,
      }),
    ),
  }),
  refundShippingLines: z.object({ nodes: z.array(z.object({ subtotalAmountSet: moneyBag })) }),
});

const transactionSchema = z.object({
  id: z.string(),
  kind: z.string(),
  status: z.string(),
  gateway: z.string().nullable(),
  processedAt: z.string().nullable(),
  test: z.boolean(),
  amountSet: moneyBag,
  fees: z.array(z.object({ amount: money })),
});

export const orderSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  processedAt: z.string(),
  updatedAt: z.string(),
  cancelledAt: z.string().nullable(),
  closedAt: z.string().nullable(),
  test: z.boolean(),
  currencyCode: z.string(),
  taxesIncluded: z.boolean(),
  displayFinancialStatus: z.string().nullable(),
  displayFulfillmentStatus: z.string().nullable(),
  sourceName: z.string().nullable(),
  customer: z.object({ id: z.string() }).nullable(),
  shippingAddress: z.object({ countryCodeV2: z.string().nullable() }).nullable(),
  subtotalPriceSet: moneyBag,
  totalDiscountsSet: moneyBag,
  totalShippingPriceSet: moneyBag,
  totalTaxSet: moneyBag,
  totalTipReceivedSet: moneyBag,
  totalPriceSet: moneyBag,
  totalRefundedSet: moneyBag,
  currentTotalDutiesSet: moneyBag.nullable(),
  lineItems: z.object({ nodes: z.array(lineItemSchema) }),
  refunds: z.array(refundSchema),
  transactions: z.array(transactionSchema),
});
export type ShopifyOrder = z.infer<typeof orderSchema>;

export const productSchema = z.object({
  id: z.string(),
  title: z.string(),
  handle: z.string().nullable(),
  status: z.string(),
  vendor: z.string().nullable(),
  productType: z.string().nullable(),
  updatedAt: z.string(),
  featuredMedia: z.object({ preview: z.object({ image: z.object({ url: z.string() }).nullable() }).nullable() }).nullable(),
  variants: z.object({
    nodes: z.array(
      z.object({
        id: z.string(),
        title: z.string().nullable(),
        sku: z.string().nullable(),
        barcode: z.string().nullable(),
        price: z.string(),
        compareAtPrice: z.string().nullable(),
        updatedAt: z.string(),
        inventoryItem: z.object({ id: z.string(), unitCost: money.nullable() }).nullable(),
      }),
    ),
  }),
});
export type ShopifyProduct = z.infer<typeof productSchema>;

export const shopSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  myshopifyDomain: z.string(),
  primaryDomain: z.object({ host: z.string() }),
  currencyCode: z.string(),
  ianaTimezone: z.string(),
  taxesIncluded: z.boolean(),
  plan: z.object({ partnerDevelopment: z.boolean(), shopifyPlus: z.boolean() }),
});
export type ShopifyShop = z.infer<typeof shopSchema>;

function m(bag: { shopMoney: { amount: string; currencyCode: string } } | null | undefined, currency: string): number {
  if (!bag) return 0;
  return toMinor(bag.shopMoney.amount, bag.shopMoney.currencyCode || currency);
}

export interface MappedOrder {
  order: {
    shopifyId: string;
    name: string;
    orderNumber: number | null;
    processedAt: Date;
    shopifyCreatedAt: Date;
    shopifyUpdatedAt: Date;
    cancelledAt: Date | null;
    closedAt: Date | null;
    financialStatus: string | null;
    fulfillmentStatus: string | null;
    currency: string;
    customerShopifyId: string | null;
    isTest: boolean;
    sourceName: string | null;
    subtotalMinor: number;
    totalDiscountsMinor: number;
    totalShippingMinor: number;
    totalTaxMinor: number;
    totalTipMinor: number;
    totalDutiesMinor: number;
    totalPriceMinor: number;
    totalRefundedMinor: number;
    taxesIncluded: boolean;
    shippingCountryCode: string | null;
  };
  lineItems: Array<{
    shopifyId: string;
    shopifyProductId: string | null;
    shopifyVariantId: string | null;
    title: string;
    sku: string | null;
    quantity: number;
    currentQuantity: number;
    unitPriceMinor: number;
    discountMinor: number;
    taxMinor: number;
    requiresShipping: boolean;
    isGiftCard: boolean;
  }>;
  refunds: Array<{
    shopifyId: string;
    processedAt: Date;
    currency: string;
    totalRefundedMinor: number;
    shippingRefundMinor: number;
    taxRefundMinor: number;
    lineItemsJson: Array<{ lineItemShopifyId: string; quantity: number; subtotalMinor: number; taxMinor: number; restockType: string }>;
  }>;
  transactions: Array<{
    shopifyId: string;
    kind: string;
    status: string;
    gateway: string | null;
    processedAt: Date;
    currency: string;
    amountMinor: number;
    feeMinor: number | null;
    feeCurrency: string | null;
    isTest: boolean;
  }>;
}

export function mapOrder(raw: unknown): MappedOrder {
  const o = orderSchema.parse(raw);
  const currency = o.currencyCode.toUpperCase();
  const orderNumber = Number.parseInt(o.name.replace(/\D/g, ""), 10);

  const lineItems = o.lineItems.nodes.map((li) => ({
    shopifyId: li.id,
    shopifyProductId: li.product?.id ?? null,
    shopifyVariantId: li.variant?.id ?? null,
    title: li.title,
    sku: li.sku,
    quantity: li.quantity,
    currentQuantity: li.currentQuantity,
    unitPriceMinor: m(li.originalUnitPriceSet, currency),
    discountMinor: m(li.totalDiscountSet, currency),
    taxMinor: li.taxLines.reduce((a, t) => a + m(t.priceSet, currency), 0),
    requiresShipping: li.requiresShipping,
    isGiftCard: li.isGiftCard,
  }));

  const refunds = o.refunds.map((r) => {
    const lines = r.refundLineItems.nodes.map((rl) => ({
      lineItemShopifyId: rl.lineItem.id,
      quantity: rl.quantity,
      subtotalMinor: m(rl.subtotalSet, currency),
      taxMinor: m(rl.totalTaxSet, currency),
      restockType: rl.restockType,
    }));
    return {
      shopifyId: r.id,
      processedAt: new Date(r.createdAt),
      currency,
      totalRefundedMinor: m(r.totalRefundedSet, currency),
      shippingRefundMinor: r.refundShippingLines.nodes.reduce((a, s) => a + m(s.subtotalAmountSet, currency), 0),
      taxRefundMinor: lines.reduce((a, l) => a + l.taxMinor, 0),
      lineItemsJson: lines,
    };
  });

  const transactions = o.transactions.map((t) => {
    const fee = t.fees.length ? t.fees.reduce((a, f) => a + toMinor(f.amount.amount, f.amount.currencyCode), 0) : null;
    return {
      shopifyId: t.id,
      kind: t.kind,
      status: t.status,
      gateway: t.gateway,
      processedAt: new Date(t.processedAt ?? o.processedAt),
      currency,
      amountMinor: m(t.amountSet, currency),
      feeMinor: fee,
      feeCurrency: t.fees[0]?.amount.currencyCode ?? null,
      isTest: t.test,
    };
  });

  return {
    order: {
      shopifyId: o.id,
      name: o.name,
      orderNumber: Number.isFinite(orderNumber) ? orderNumber : null,
      processedAt: new Date(o.processedAt),
      shopifyCreatedAt: new Date(o.createdAt),
      shopifyUpdatedAt: new Date(o.updatedAt),
      cancelledAt: o.cancelledAt ? new Date(o.cancelledAt) : null,
      closedAt: o.closedAt ? new Date(o.closedAt) : null,
      financialStatus: o.displayFinancialStatus,
      fulfillmentStatus: o.displayFulfillmentStatus,
      currency,
      customerShopifyId: o.customer?.id ?? null,
      isTest: o.test,
      sourceName: o.sourceName,
      subtotalMinor: lineItems.reduce((a, l) => a + l.unitPriceMinor * l.quantity, 0),
      totalDiscountsMinor: m(o.totalDiscountsSet, currency),
      totalShippingMinor: m(o.totalShippingPriceSet, currency),
      totalTaxMinor: m(o.totalTaxSet, currency),
      totalTipMinor: m(o.totalTipReceivedSet, currency),
      totalDutiesMinor: m(o.currentTotalDutiesSet, currency),
      totalPriceMinor: m(o.totalPriceSet, currency),
      totalRefundedMinor: m(o.totalRefundedSet, currency),
      taxesIncluded: o.taxesIncluded,
      shippingCountryCode: o.shippingAddress?.countryCodeV2 ?? null,
    },
    lineItems,
    refunds,
    transactions,
  };
}

export interface MappedProduct {
  product: { shopifyId: string; title: string; handle: string | null; vendor: string | null; productType: string | null; status: string; imageUrl: string | null; shopifyUpdatedAt: Date };
  variants: Array<{ shopifyId: string; title: string | null; sku: string | null; barcode: string | null; priceMinor: number; inventoryItemId: string | null; shopifyUnitCostMinor: number | null; shopifyUnitCostCurrency: string | null }>;
}

export function mapProduct(raw: unknown, storeCurrency: string): MappedProduct {
  const p = productSchema.parse(raw);
  return {
    product: {
      shopifyId: p.id,
      title: p.title,
      handle: p.handle,
      vendor: p.vendor,
      productType: p.productType,
      status: p.status,
      imageUrl: p.featuredMedia?.preview?.image?.url ?? null,
      shopifyUpdatedAt: new Date(p.updatedAt),
    },
    variants: p.variants.nodes.map((v) => ({
      shopifyId: v.id,
      title: v.title,
      sku: v.sku,
      barcode: v.barcode,
      priceMinor: toMinor(v.price, storeCurrency),
      inventoryItemId: v.inventoryItem?.id ?? null,
      shopifyUnitCostMinor: v.inventoryItem?.unitCost ? toMinor(v.inventoryItem.unitCost.amount, v.inventoryItem.unitCost.currencyCode) : null,
      shopifyUnitCostCurrency: v.inventoryItem?.unitCost?.currencyCode ?? null,
    })),
  };
}

/** Convert a REST-shaped webhook payload id (numeric) into a GraphQL gid. */
export function gid(resource: "Order" | "Product" | "ProductVariant" | "Refund" | "Customer", id: number | string): string {
  const s = String(id);
  return s.startsWith("gid://") ? s : `gid://shopify/${resource}/${s}`;
}
