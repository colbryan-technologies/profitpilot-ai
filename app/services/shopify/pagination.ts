import { z } from "zod";
import type { AdminGraphql } from "./admin.server";
import {
  ORDER_LINES_PAGE_QUERY,
  ORDER_VERSION_QUERY,
  PRODUCT_VARIANTS_PAGE_QUERY,
  REFUND_LINES_PAGE_QUERY,
  REFUND_SHIPPING_PAGE_QUERY,
} from "./queries";

const connection = z.object({
  nodes: z.array(z.unknown()),
  pageInfo: z.object({
    hasNextPage: z.boolean(),
    endCursor: z.string().nullable(),
  }),
});
const identity = z
  .object({ id: z.string(), updatedAt: z.string() })
  .passthrough();
const refund = z
  .object({
    id: z.string(),
    refundLineItems: connection,
    refundShippingLines: connection,
  })
  .passthrough();
const order = identity.extend({
  lineItems: connection,
  refunds: z.array(refund),
});
const product = identity.extend({ variants: connection });

/** Fail closed on missing metadata or stalled/cyclic cursors; never infer completeness. */
export async function collectConnection(
  initial: unknown,
  next: (cursor: string) => Promise<unknown>,
) {
  let page = connection.parse(initial);
  const nodes = [...page.nodes];
  const seen = new Set<string>();
  while (page.pageInfo.hasNextPage) {
    const cursor = page.pageInfo.endCursor;
    if (!cursor || seen.has(cursor) || !page.nodes.length)
      throw new Error("Shopify pagination did not advance");
    seen.add(cursor);
    page = connection.parse(await next(cursor));
    nodes.push(...page.nodes);
  }
  return { nodes, pageInfo: page.pageInfo };
}

export async function completeOrder(raw: unknown, gql: AdminGraphql) {
  const value = order.parse(raw);
  let fetched = false;
  value.lineItems = await collectConnection(value.lineItems, async (after) => {
    fetched = true;
    const data = await gql<{ order: unknown }>(ORDER_LINES_PAGE_QUERY, {
      id: value.id,
      after,
    });
    const page = identity.extend({ lineItems: connection }).parse(data.order);
    if (page.id !== value.id || page.updatedAt !== value.updatedAt)
      throw new Error("Order changed during pagination; retry synchronization");
    return page.lineItems;
  });
  for (const r of value.refunds) {
    for (const [key, query] of [
      ["refundLineItems", REFUND_LINES_PAGE_QUERY],
      ["refundShippingLines", REFUND_SHIPPING_PAGE_QUERY],
    ] as const) {
      r[key] = await collectConnection(r[key], async (after) => {
        fetched = true;
        const data = await gql<{ node: unknown }>(query, { id: r.id, after });
        const page = z
          .object({ id: z.literal(r.id), [key]: connection })
          .parse(data.node);
        return page[key];
      });
    }
  }
  if (fetched) {
    const data = await gql<{ order: unknown }>(ORDER_VERSION_QUERY, {
      id: value.id,
    });
    const current = identity.parse(data.order);
    if (current.id !== value.id || current.updatedAt !== value.updatedAt)
      throw new Error("Order changed during pagination; retry synchronization");
  }
  return value;
}

export async function completeProduct(raw: unknown, gql: AdminGraphql) {
  const value = product.parse(raw);
  value.variants = await collectConnection(value.variants, async (after) => {
    const data = await gql<{ product: unknown }>(PRODUCT_VARIANTS_PAGE_QUERY, {
      id: value.id,
      after,
    });
    const page = product.parse(data.product);
    if (page.id !== value.id || page.updatedAt !== value.updatedAt)
      throw new Error(
        "Product changed during pagination; retry synchronization",
      );
    return page.variants;
  });
  return value;
}
