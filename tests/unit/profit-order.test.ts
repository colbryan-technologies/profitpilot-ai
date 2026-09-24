import { describe, expect, it } from "vitest";
import { computeOrderProfit } from "../../app/domain/profit/order";
import { HistoryCogsResolver, NO_COGS } from "../../app/domain/profit/cogs";
import { D, ctx, line, order } from "../fixtures/orders";

describe("computeOrderProfit", () => {
  it("includes collected tax once for tax-exclusive include-tax reporting", () => {
    const o = order({
      lineItems: [line({ id: "l1", quantity: 1, unitPriceMinor: 10000, taxMinor: 2300 })],
      totalTaxMinor: 2415,
      totalShippingMinor: 500,
    });
    const r = computeOrderProfit(
      o,
      ctx({ taxTreatment: "INCLUDE_TAX_AS_REVENUE" }),
    );
    expect(r.netSalesMinor).toBe(12300);
    expect(r.shippingRevenueMinor).toBe(615);
  });

  it.each(["EXCLUDE_COLLECTED_TAX", "INCLUDE_TAX_AS_REVENUE"] as const)(
    "fully refunds tax-inclusive goods under %s",
    (taxTreatment) => {
      const o = order({
        taxesIncluded: true,
        lineItems: [
          line({ id: "l1", quantity: 1, unitPriceMinor: 12300, taxMinor: 2300 }),
        ],
        totalTaxMinor: 2300,
        refunds: [
          {
            id: "r1",
            processedAt: D("2026-05-15T00:00:00Z"),
            totalRefundedMinor: 12300,
            shippingRefundMinor: 0,
            taxRefundMinor: 2300,
            lineItems: [
              {
                lineItemId: "l1",
                quantity: 1,
                subtotalMinor: 10000,
                taxMinor: 2300,
                restockType: "RETURN",
              },
            ],
          },
        ],
      });
      expect(computeOrderProfit(o, ctx({ taxTreatment })).netSalesMinor).toBe(
        0,
      );
    },
  );

  it("normal sale: revenue − COGS − shipping − fees", () => {
    // 2 × €50 hoodie, €5 shipping charged, May order → COGS €10.50 each (Apr–Jun band)
    const o = order();
    const r = computeOrderProfit(o, ctx());
    expect(r.grossSalesMinor).toBe(10_000);
    expect(r.discountsMinor).toBe(0);
    expect(r.netSalesMinor).toBe(10_000);
    expect(r.cogsMinor).toBe(2_100);
    expect(r.lines[0].cogsSource).toBe("HISTORY");
    expect(r.grossProfitMinor).toBe(7_900);
    expect(r.shippingRevenueMinor).toBe(500);
    expect(r.shippingCostMinor).toBe(400);
    expect(r.shippingCostSource).toBe("RULE");
    // fee: 2.9% of €105.00 = 304.5 → 304 (half-even) + 30 = 334
    expect(r.paymentFeesMinor).toBe(334);
    expect(r.paymentFeeSource).toBe("ESTIMATED");
    expect(r.contributionProfitMinor).toBe(7_900 + 500 - 400 - 334);
    expect(r.cogsCoverage).toBe(100);
    expect(r.contributionMarginBps).toBe(
      Math.round(((7_900 + 500 - 400 - 334) / 10_000) * 10_000),
    );
  });

  it("discount reduces net sales and gross profit", () => {
    const o = order({
      lineItems: [
        line({
          id: "l1",
          quantity: 2,
          unitPriceMinor: 5000,
          discountMinor: 1500,
        }),
      ],
    });
    const r = computeOrderProfit(o, ctx());
    expect(r.grossSalesMinor).toBe(10_000);
    expect(r.discountsMinor).toBe(1_500);
    expect(r.netSalesMinor).toBe(8_500);
    expect(r.grossProfitMinor).toBe(8_500 - 2_100);
  });

  it("partial refund with restock recovers COGS for returned units", () => {
    const o = order({
      refunds: [
        {
          id: "r1",
          processedAt: D("2026-05-15T00:00:00Z"),
          totalRefundedMinor: 5_000,
          shippingRefundMinor: 0,
          taxRefundMinor: 0,
          lineItems: [
            {
              lineItemId: "l1",
              quantity: 1,
              subtotalMinor: 5_000,
              taxMinor: 0,
              restockType: "RETURN",
            },
          ],
        },
      ],
    });
    const r = computeOrderProfit(o, ctx());
    expect(r.refundsMinor).toBe(5_000);
    expect(r.netSalesMinor).toBe(5_000);
    expect(r.lines[0].cogsQuantity).toBe(1);
    expect(r.cogsMinor).toBe(1_050);
    expect(r.grossProfitMinor).toBe(3_950);
    // Fees stay on the original charge; processors typically keep them.
    expect(r.paymentFeesMinor).toBe(334);
  });

  it("partial refund without restock keeps COGS", () => {
    const o = order({
      refunds: [
        {
          id: "r1",
          processedAt: D("2026-05-15T00:00:00Z"),
          totalRefundedMinor: 5_000,
          shippingRefundMinor: 0,
          taxRefundMinor: 0,
          lineItems: [
            {
              lineItemId: "l1",
              quantity: 1,
              subtotalMinor: 5_000,
              taxMinor: 0,
              restockType: "NO_RESTOCK",
            },
          ],
        },
      ],
    });
    const r = computeOrderProfit(o, ctx());
    expect(r.cogsMinor).toBe(2_100);
    expect(r.grossProfitMinor).toBe(2_900);
  });

  it("full refund including shipping yields negative contribution (fees + shipping lost)", () => {
    const o = order({
      refunds: [
        {
          id: "r1",
          processedAt: D("2026-05-15T00:00:00Z"),
          totalRefundedMinor: 10_500,
          shippingRefundMinor: 500,
          taxRefundMinor: 0,
          lineItems: [
            {
              lineItemId: "l1",
              quantity: 2,
              subtotalMinor: 10_000,
              taxMinor: 0,
              restockType: "RETURN",
            },
          ],
        },
      ],
    });
    const r = computeOrderProfit(o, ctx());
    expect(r.netSalesMinor).toBe(0);
    expect(r.cogsMinor).toBe(0);
    expect(r.shippingRevenueMinor).toBe(0);
    expect(r.shippingCostMinor).toBe(400); // carrier cost is retained after the return
    expect(r.contributionProfitMinor).toBe(-734);
  });

  it("missing COGS is reported, not fabricated", () => {
    const o = order({
      lineItems: [
        line({ id: "l1", variantId: "unknown", quantity: 3 }),
        line({ id: "l2", variantId: "v2", quantity: 1, unitPriceMinor: 8000 }),
      ],
    });
    const r = computeOrderProfit(o, ctx());
    expect(r.missingCogsLineCount).toBe(1);
    expect(r.lines[0].cogsSource).toBe("MISSING");
    expect(r.lines[0].cogsMinor).toBe(0);
    expect(r.lines[1].cogsMinor).toBe(2_000);
    expect(r.cogsCoverage).toBe(25); // 1 of 4 units
  });

  it("uses historical COGS matching the order date", () => {
    const jan = computeOrderProfit(
      order({ processedAt: D("2026-02-01T00:00:00Z") }),
      ctx(),
    );
    const may = computeOrderProfit(
      order({ processedAt: D("2026-05-01T00:00:00Z") }),
      ctx(),
    );
    const aug = computeOrderProfit(
      order({ processedAt: D("2026-08-01T00:00:00Z") }),
      ctx(),
    );
    expect(jan.cogsMinor).toBe(1_800);
    expect(may.cogsMinor).toBe(2_100);
    expect(aug.cogsMinor).toBe(2_200);
  });

  it("falls back to earliest known cost for orders predating history", () => {
    const r = computeOrderProfit(
      order({ processedAt: D("2025-06-01T00:00:00Z") }),
      ctx(),
    );
    expect(r.cogsMinor).toBe(1_800);
    expect(r.lines[0].cogsSource).toBe("CURRENT");
  });

  it("uses Shopify inventory cost when no history exists", () => {
    const resolver = new HistoryCogsResolver(
      [],
      [{ variantId: "v9", unitCostMinor: 1234 }],
    );
    const r = computeOrderProfit(
      order({ lineItems: [line({ id: "l1", variantId: "v9", quantity: 1 })] }),
      ctx({ cogs: resolver }),
    );
    expect(r.lines[0].cogsSource).toBe("SHOPIFY");
    expect(r.cogsMinor).toBe(1234);
  });

  it("uses actual shipping cost when known", () => {
    const r = computeOrderProfit(
      order({ actualShippingCostMinor: 725 }),
      ctx(),
    );
    expect(r.shippingCostMinor).toBe(725);
    expect(r.shippingCostSource).toBe("ACTUAL");
  });

  it("reports UNKNOWN shipping cost when no rule exists", () => {
    const r = computeOrderProfit(order(), ctx({ shippingRules: [] }));
    expect(r.shippingCostMinor).toBe(0);
    expect(r.shippingCostSource).toBe("UNKNOWN");
  });

  it("prefers country-specific shipping rule and per-item pricing", () => {
    const r = computeOrderProfit(
      order({ shippingCountryCode: "US" }),
      ctx({
        shippingRules: [
          {
            countryCode: null,
            flatMinor: 400,
            perItemMinor: 0,
            percentBps: 0,
            priority: 0,
          },
          {
            countryCode: "US",
            flatMinor: 1000,
            perItemMinor: 150,
            percentBps: 0,
            priority: 1,
          },
        ],
      }),
    );
    expect(r.shippingCostMinor).toBe(1000 + 150 * 2);
  });

  it("uses actual transaction fees when Shopify provides them", () => {
    const o = order({
      transactions: [
        {
          id: "t1",
          kind: "SALE",
          status: "SUCCESS",
          gateway: "shopify_payments",
          amountMinor: 10_500,
          feeMinor: 300,
        },
      ],
    });
    const r = computeOrderProfit(o, ctx());
    expect(r.paymentFeesMinor).toBe(300);
    expect(r.paymentFeeSource).toBe("ACTUAL");
  });

  it("applies gateway overrides and skips manual gateways", () => {
    const paypal = computeOrderProfit(
      order({
        transactions: [
          {
            id: "t1",
            kind: "CAPTURE",
            status: "SUCCESS",
            gateway: "paypal",
            amountMinor: 10_000,
            feeMinor: null,
          },
        ],
      }),
      ctx(),
    );
    expect(paypal.paymentFeesMinor).toBe(349 + 35);
    const manual = computeOrderProfit(
      order({
        transactions: [
          {
            id: "t1",
            kind: "SALE",
            status: "SUCCESS",
            gateway: "manual",
            amountMinor: 10_000,
            feeMinor: null,
          },
        ],
      }),
      ctx(),
    );
    expect(manual.paymentFeesMinor).toBe(0);
  });

  it("tax-exclusive: collected tax is excluded from net sales and reported separately", () => {
    const o = order({
      lineItems: [
        line({
          id: "l1",
          quantity: 1,
          unitPriceMinor: 10_000,
          taxMinor: 2_300,
        }),
      ],
      totalTaxMinor: 2_300,
    });
    const r = computeOrderProfit(o, ctx());
    expect(r.netSalesMinor).toBe(10_000);
    expect(r.taxCollectedMinor).toBe(2_300);
  });

  it("tax-inclusive: tax is backed out of prices under EXCLUDE_COLLECTED_TAX", () => {
    // €123 tax-inclusive price at 23% VAT → €100 net, €23 tax
    const o = order({
      taxesIncluded: true,
      lineItems: [
        line({
          id: "l1",
          quantity: 1,
          unitPriceMinor: 12_300,
          taxMinor: 2_300,
        }),
      ],
      totalTaxMinor: 2_300,
    });
    const r = computeOrderProfit(o, ctx());
    expect(r.grossSalesMinor).toBe(12_300);
    expect(r.netSalesMinor).toBe(10_000);
    expect(r.taxCollectedMinor).toBe(2_300);
  });

  it("tax-inclusive with INCLUDE_TAX_AS_REVENUE keeps tax inside net sales", () => {
    const o = order({
      taxesIncluded: true,
      lineItems: [
        line({
          id: "l1",
          quantity: 1,
          unitPriceMinor: 12_300,
          taxMinor: 2_300,
        }),
      ],
      totalTaxMinor: 2_300,
    });
    const r = computeOrderProfit(
      o,
      ctx({ taxTreatment: "INCLUDE_TAX_AS_REVENUE" }),
    );
    expect(r.netSalesMinor).toBe(12_300);
  });

  it("tax-inclusive shipping backs out shipping tax from shipping revenue", () => {
    const o = order({
      taxesIncluded: true,
      totalShippingMinor: 615,
      totalTaxMinor: 2_300 + 115,
      lineItems: [
        line({
          id: "l1",
          quantity: 1,
          unitPriceMinor: 12_300,
          taxMinor: 2_300,
        }),
      ],
    });
    const r = computeOrderProfit(o, ctx());
    expect(r.shippingRevenueMinor).toBe(500);
  });

  it("zero-profit order", () => {
    // sell at cost with no shipping, no fee gateway
    const o = order({
      lineItems: [
        line({
          id: "l1",
          variantId: "v2",
          quantity: 1,
          unitPriceMinor: 2_000,
          requiresShipping: false,
        }),
      ],
      totalShippingMinor: 0,
      transactions: [
        {
          id: "t1",
          kind: "SALE",
          status: "SUCCESS",
          gateway: "manual",
          amountMinor: 2_000,
          feeMinor: null,
        },
      ],
    });
    const r = computeOrderProfit(o, ctx());
    expect(r.contributionProfitMinor).toBe(0);
    expect(r.contributionMarginBps).toBe(0);
  });

  it("negative-profit order", () => {
    const o = order({
      lineItems: [
        line({ id: "l1", variantId: "v2", quantity: 1, unitPriceMinor: 1_500 }),
      ],
      totalShippingMinor: 0,
    });
    const r = computeOrderProfit(o, ctx());
    expect(r.contributionProfitMinor).toBeLessThan(0);
  });

  it("gift cards carry zero COGS and no shipping", () => {
    const o = order({
      lineItems: [
        line({
          id: "l1",
          variantId: null,
          quantity: 1,
          unitPriceMinor: 2_500,
          isGiftCard: true,
          requiresShipping: false,
        }),
      ],
      totalShippingMinor: 0,
    });
    const r = computeOrderProfit(o, ctx({ cogs: NO_COGS }));
    expect(r.cogsMinor).toBe(0);
    expect(r.missingCogsLineCount).toBe(0);
    expect(r.shippingCostMinor).toBe(0);
  });

  it("test orders and unpaid cancellations are excluded", () => {
    expect(computeOrderProfit(order({ isTest: true }), ctx()).isExcluded).toBe(
      true,
    );
    const cancelled = order({
      cancelledAt: D("2026-05-10T13:00:00Z"),
      transactions: [
        {
          id: "t1",
          kind: "AUTHORIZATION",
          status: "SUCCESS",
          gateway: "shopify_payments",
          amountMinor: 10_500,
          feeMinor: null,
        },
      ],
    });
    expect(computeOrderProfit(cancelled, ctx()).isExcluded).toBe(true);
    const cancelledPaid = order({ cancelledAt: D("2026-05-10T13:00:00Z") });
    expect(computeOrderProfit(cancelledPaid, ctx()).isExcluded).toBe(false);
  });

  it("multi-currency: order currency is preserved on the result", () => {
    const r = computeOrderProfit(
      order({ currency: "ngn" }),
      ctx({ currency: "NGN" }),
    );
    expect(r.currency).toBe("NGN");
  });

  it("tips add to and duties subtract from contribution", () => {
    const r = computeOrderProfit(
      order({ totalTipMinor: 200, totalDutiesMinor: 150 }),
      ctx(),
    );
    const baseline = computeOrderProfit(order(), ctx());
    expect(r.contributionProfitMinor).toBe(
      baseline.contributionProfitMinor + 200 - 150,
    );
  });
});
