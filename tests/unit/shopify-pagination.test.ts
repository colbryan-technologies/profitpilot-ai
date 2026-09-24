import { describe, expect, it, vi } from "vitest";
import {
  collectConnection,
  completeOrder,
  completeProduct,
} from "../../app/services/shopify/pagination";
import type { AdminGraphql } from "../../app/services/shopify/admin.server";
import {
  ORDER_LINES_PAGE_QUERY,
  ORDER_VERSION_QUERY,
  PRODUCT_VARIANTS_PAGE_QUERY,
  REFUND_LINES_PAGE_QUERY,
  REFUND_SHIPPING_PAGE_QUERY,
} from "../../app/services/shopify/queries";

const page = (
  nodes: unknown[],
  hasNextPage = false,
  endCursor: string | null = null,
) => ({ nodes, pageInfo: { hasNextPage, endCursor } });
const base = () => ({
  id: "order-1",
  updatedAt: "2026-09-24T00:00:00Z",
  lineItems: page([{ id: "line-1" }]),
  refunds: [],
  name: "Preserved",
});

describe("complete Shopify connections", () => {
  it("collects more than 100 nodes without dropping first-page values", async () => {
    const first = Array.from({ length: 100 }, (_, id) => ({ id }));
    const next = vi
      .fn()
      .mockResolvedValueOnce(page([{ id: 100 }], true, "second"))
      .mockResolvedValueOnce(page([{ id: 101 }]));
    const result = await collectConnection(page(first, true, "first"), next);
    expect(result.nodes).toHaveLength(102);
    expect(result.nodes[0]).toEqual({ id: 0 });
    expect(next.mock.calls).toEqual([["first"], ["second"]]);
    expect(result.pageInfo.hasNextPage).toBe(false);
  });
  it.each([null, ""])(
    "rejects a missing continuation cursor (%s)",
    async (cursor) => {
      await expect(
        collectConnection(page([1], true, cursor), vi.fn()),
      ).rejects.toThrow("did not advance");
    },
  );
  it("rejects repeated cursors and missing completeness metadata", async () => {
    await expect(
      collectConnection(page([1], true, "a"), async () => page([2], true, "a")),
    ).rejects.toThrow("did not advance");
    await expect(collectConnection({ nodes: [] }, vi.fn())).rejects.toThrow();
  });
  it("does not request more data for a complete order", async () => {
    const gql = vi.fn();
    expect(await completeOrder(base(), gql as AdminGraphql)).toEqual(base());
    expect(gql).not.toHaveBeenCalled();
  });
  it("fetches all refund connections and verifies the final order version", async () => {
    const raw = {
      ...base(),
      lineItems: page([1], true, "line"),
      refunds: [
        {
          id: "refund-1",
          refundLineItems: page([1], true, "refund"),
          refundShippingLines: page([1], true, "shipping"),
        },
      ],
    };
    const gql = vi.fn(async (query: string) => {
      if (query === ORDER_LINES_PAGE_QUERY)
        return { order: { ...base(), lineItems: page([2]) } };
      if (query === REFUND_LINES_PAGE_QUERY)
        return { node: { id: "refund-1", refundLineItems: page([2]) } };
      if (query === REFUND_SHIPPING_PAGE_QUERY)
        return { node: { id: "refund-1", refundShippingLines: page([2]) } };
      if (query === ORDER_VERSION_QUERY) return { order: base() };
      throw new Error("Unexpected query");
    });
    const result = await completeOrder(raw, gql as AdminGraphql);
    expect(result.lineItems.nodes).toEqual([1, 2]);
    expect(result.refunds[0].refundLineItems.nodes).toEqual([1, 2]);
    expect(result.refunds[0].refundShippingLines.nodes).toEqual([1, 2]);
    expect(result.name).toBe("Preserved");
    expect(gql).toHaveBeenLastCalledWith(ORDER_VERSION_QUERY, {
      id: "order-1",
    });
  });
  it("rejects orders modified during refund pagination", async () => {
    const raw = {
      ...base(),
      refunds: [
        {
          id: "refund-1",
          refundLineItems: page([1], true, "r"),
          refundShippingLines: page([]),
        },
      ],
    };
    const gql = vi
      .fn()
      .mockResolvedValueOnce({
        node: { id: "refund-1", refundLineItems: page([2]) },
      })
      .mockResolvedValueOnce({ order: { ...base(), updatedAt: "changed" } });
    await expect(completeOrder(raw, gql as AdminGraphql)).rejects.toThrow(
      "changed during pagination",
    );
  });
  it("fails if a product is deleted between pages", async () => {
    const gql = vi.fn().mockResolvedValue({ product: null });
    await expect(
      completeProduct(
        { id: "p", updatedAt: "now", variants: page([1], true, "a") },
        gql as AdminGraphql,
      ),
    ).rejects.toThrow();
  });
  it("preserves and appends product variants", async () => {
    const gql = vi.fn().mockResolvedValue({
      product: { id: "p", updatedAt: "now", variants: page([2]) },
    });
    const result = await completeProduct(
      {
        id: "p",
        updatedAt: "now",
        title: "Product",
        variants: page([1], true, "a"),
      },
      gql as AdminGraphql,
    );
    expect(result.variants.nodes).toEqual([1, 2]);
    expect(result.title).toBe("Product");
    expect(gql).toHaveBeenCalledWith(PRODUCT_VARIANTS_PAGE_QUERY, {
      id: "p",
      after: "a",
    });
  });
});
