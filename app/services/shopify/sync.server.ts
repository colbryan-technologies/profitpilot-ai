import prisma from "../../db.server";
import { logger } from "../../lib/logger.server";
import { adminGraphqlForShop, type AdminGraphql } from "./admin.server";
import { mapOrder, mapProduct, shopSchema } from "./mappers";
import { upsertOrder, upsertProduct } from "./persist.server";
import { completeOrder, completeProduct } from "./pagination";
import {
  BULK_ORDERS_QUERY,
  BULK_RUN_MUTATION,
  BULK_STATUS_QUERY,
  CURRENT_BULK_QUERY,
  ORDERS_COUNT_QUERY,
  ORDERS_PAGE_QUERY,
  ORDER_BY_ID_QUERY,
  PRODUCTS_PAGE_QUERY,
  PRODUCT_BY_ID_QUERY,
  SHOP_QUERY,
} from "./queries";

const PAGE = 50;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface SyncProgress {
  processed: number;
  total: number | null;
  cursor: string | null;
}

export type ProgressReporter = (p: SyncProgress) => Promise<void>;

export async function syncShopInfo(
  storeId: string,
  shopDomain: string,
  graphql?: AdminGraphql,
): Promise<void> {
  const gql = graphql ?? (await adminGraphqlForShop(shopDomain));
  const data = await gql<{ shop: unknown }>(SHOP_QUERY);
  const shop = shopSchema.parse(data.shop);
  await prisma.store.update({
    where: { id: storeId },
    data: {
      shopifyShopId: BigInt(shop.id.split("/").pop() ?? "0"),
      name: shop.name,
      email: shop.email,
      currency: shop.currencyCode.toUpperCase(),
      ianaTimezone: shop.ianaTimezone,
      planName: shop.plan.shopifyPlus
        ? "plus"
        : shop.plan.partnerDevelopment
          ? "development"
          : null,
    },
  });
  const taxConfig = await prisma.taxConfig.findUnique({ where: { storeId } });
  if (taxConfig && !taxConfig.confirmedAt) {
    // Default assumption from shop settings; the merchant confirms it in Settings → Tax.
    await prisma.taxConfig.update({
      where: { storeId },
      data: {
        notes: shop.taxesIncluded
          ? "Shop prices include tax (from Shopify settings)."
          : "Shop prices exclude tax (from Shopify settings).",
      },
    });
  }
}

export async function syncProducts(
  storeId: string,
  shopDomain: string,
  opts: {
    since?: Date | null;
    cursor?: string | null;
    onProgress?: ProgressReporter;
  } = {},
): Promise<SyncProgress> {
  const gql = await adminGraphqlForShop(shopDomain);
  const store = await prisma.store.findUniqueOrThrow({
    where: { id: storeId },
    select: { currency: true },
  });
  let after: string | null = opts.cursor ?? null;
  let processed = 0;
  const query = opts.since ? `updated_at:>'${opts.since.toISOString()}'` : null;
  for (;;) {
    const data = await gql<{
      products: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: unknown[];
      };
    }>(PRODUCTS_PAGE_QUERY, { first: PAGE, after, query });
    for (const raw of data.products.nodes) {
      const id = (raw as { id: string }).id;
      const detail = await gql<{ product: unknown | null }>(
        PRODUCT_BY_ID_QUERY,
        { id },
      );
      if (!detail.product)
        throw new Error("Product no longer accessible; retry synchronization");
      await upsertProduct(
        storeId,
        mapProduct(await completeProduct(detail.product, gql), store.currency),
      );
      processed++;
    }
    after = data.products.pageInfo.endCursor;
    await opts.onProgress?.({ processed, total: null, cursor: after });
    if (!data.products.pageInfo.hasNextPage) break;
  }
  return { processed, total: null, cursor: null };
}

export async function syncSingleProduct(
  storeId: string,
  shopDomain: string,
  productGid: string,
): Promise<void> {
  const gql = await adminGraphqlForShop(shopDomain);
  const store = await prisma.store.findUniqueOrThrow({
    where: { id: storeId },
    select: { currency: true },
  });
  const data = await gql<{ product: unknown | null }>(PRODUCT_BY_ID_QUERY, {
    id: productGid,
  });
  if (data.product)
    await upsertProduct(
      storeId,
      mapProduct(await completeProduct(data.product, gql), store.currency),
    );
}

export async function syncSingleOrder(
  storeId: string,
  shopDomain: string,
  orderGid: string,
): Promise<boolean> {
  const gql = await adminGraphqlForShop(shopDomain);
  const data = await gql<{ order: unknown | null }>(ORDER_BY_ID_QUERY, {
    id: orderGid,
  });
  if (!data.order) return false;
  const { changed } = await upsertOrder(
    storeId,
    mapOrder(await completeOrder(data.order, gql)),
  );
  return changed;
}

export async function countOrders(
  shopDomain: string,
  query: string | null,
): Promise<number | null> {
  const gql = await adminGraphqlForShop(shopDomain);
  const data = await gql<{
    ordersCount: { count: number; precision: string } | null;
  }>(ORDERS_COUNT_QUERY, { query });
  return data.ordersCount?.count ?? null;
}

/**
 * Cursor-paginated order sync. Used for incremental sync and as a fallback
 * when bulk operations are unavailable. Resumable via `cursor`.
 */
export async function syncOrdersPaginated(
  storeId: string,
  shopDomain: string,
  opts: {
    query: string | null;
    cursor?: string | null;
    total?: number | null;
    onProgress?: ProgressReporter;
    shouldStop?: () => Promise<boolean>;
  },
): Promise<SyncProgress> {
  const gql = await adminGraphqlForShop(shopDomain);
  let after: string | null = opts.cursor ?? null;
  let processed = 0;
  for (;;) {
    if (await opts.shouldStop?.())
      return { processed, total: opts.total ?? null, cursor: after };
    const data = await gql<{
      orders: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: unknown[];
      };
    }>(ORDERS_PAGE_QUERY, { first: PAGE, after, query: opts.query });
    for (const raw of data.orders.nodes) {
      const id = (raw as { id: string }).id;
      const detail = await gql<{ order: unknown | null }>(ORDER_BY_ID_QUERY, {
        id,
      });
      if (!detail.order)
        throw new Error("Order no longer accessible; retry synchronization");
      await upsertOrder(
        storeId,
        mapOrder(await completeOrder(detail.order, gql)),
      );
      processed++;
    }
    after = data.orders.pageInfo.endCursor;
    await opts.onProgress?.({
      processed,
      total: opts.total ?? null,
      cursor: after,
    });
    if (!data.orders.pageInfo.hasNextPage) break;
  }
  return { processed, total: opts.total ?? null, cursor: null };
}

/**
 * Historical sync via Bulk Operations. Shopify runs the query asynchronously
 * and returns an identity-only JSONL file. Each order is then fetched with
 * complete nested paging before mapping and persistence.
 *
 * Returns null if a bulk operation could not be started (e.g. another
 * operation is already running for this app on the shop), so the caller can
 * fall back to pagination.
 */
export async function startBulkOrders(
  shopDomain: string,
  query: string | null,
): Promise<string | null> {
  const gql = await adminGraphqlForShop(shopDomain);
  const current = await gql<{
    currentBulkOperation: { id: string; status: string } | null;
  }>(CURRENT_BULK_QUERY);
  if (
    current.currentBulkOperation &&
    ["CREATED", "RUNNING"].includes(current.currentBulkOperation.status)
  ) {
    return null; // An unrelated operation is not proof of this job's requested dataset.
  }
  const bulkQuery = BULK_ORDERS_QUERY.replace(
    "query ProfitPilotBulkOrders($query: String) {",
    "{",
  ).replace(
    "orders(query: $query)",
    query ? `orders(query: ${JSON.stringify(query)})` : "orders",
  );
  const res = await gql<{
    bulkOperationRunQuery: {
      bulkOperation: { id: string; status: string } | null;
      userErrors: Array<{ message: string }>;
    };
  }>(BULK_RUN_MUTATION, { query: bulkQuery });
  if (
    res.bulkOperationRunQuery.userErrors.length ||
    !res.bulkOperationRunQuery.bulkOperation
  ) {
    logger.warn(
      { shopDomain, errors: res.bulkOperationRunQuery.userErrors },
      "bulk operation not started",
    );
    return null;
  }
  return res.bulkOperationRunQuery.bulkOperation.id;
}

export interface BulkStatus {
  id: string;
  status: string;
  errorCode: string | null;
  objectCount: string | number | null;
  url: string | null;
  partialDataUrl: string | null;
}

export async function pollBulk(
  shopDomain: string,
  id: string,
): Promise<BulkStatus> {
  const gql = await adminGraphqlForShop(shopDomain);
  const data = await gql<{ node: BulkStatus | null }>(BULK_STATUS_QUERY, {
    id,
  });
  if (!data.node) throw new Error("Bulk operation not found");
  return data.node;
}

export async function waitForBulk(
  shopDomain: string,
  id: string,
  opts: { timeoutMs: number; onTick?: (s: BulkStatus) => Promise<void> },
): Promise<BulkStatus> {
  const started = Date.now();
  let delay = 2_000;
  for (;;) {
    const status = await pollBulk(shopDomain, id);
    await opts.onTick?.(status);
    if (["COMPLETED", "FAILED", "CANCELED", "EXPIRED"].includes(status.status))
      return status;
    if (Date.now() - started > opts.timeoutMs)
      throw new Error("Bulk operation timed out");
    await sleep(delay);
    delay = Math.min(15_000, Math.round(delay * 1.5));
  }
}

/** Stream the identity-only bulk export; unexpected shapes fail instead of disappearing. */
export async function* iterateBulkOrders(
  url: string,
): AsyncGenerator<{ id: string }> {
  const res = await fetch(url);
  if (!res.ok || !res.body)
    throw new Error(`Bulk download failed (${res.status})`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const parse = (text: string) => {
    const value = JSON.parse(text) as { id?: unknown; __parentId?: unknown };
    if (
      typeof value.id !== "string" ||
      !value.id.startsWith("gid://shopify/Order/") ||
      value.__parentId
    ) {
      throw new Error("Unexpected record in bulk order identity export");
    }
    return { id: value.id };
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const raw = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (raw) yield parse(raw);
      }
      if (buffer.length > 1_000_000)
        throw new Error("Bulk identity record exceeds size limit");
    }
    buffer += decoder.decode();
    if (buffer.trim()) yield parse(buffer.trim());
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}
export async function ingestBulkOrders(
  storeId: string,
  shopDomain: string,
  url: string,
  opts: { onProgress?: ProgressReporter; total?: number | null } = {},
): Promise<number> {
  const gql = await adminGraphqlForShop(shopDomain);
  let processed = 0;
  for await (const raw of iterateBulkOrders(url)) {
    try {
      const id = (raw as { id?: string }).id;
      if (!id?.startsWith("gid://shopify/Order/"))
        throw new Error("Invalid bulk order identity");
      const data = await gql<{ order: unknown | null }>(ORDER_BY_ID_QUERY, {
        id,
      });
      if (!data.order)
        throw new Error(
          "Bulk order no longer accessible; retry synchronization",
        );
      await upsertOrder(
        storeId,
        mapOrder(await completeOrder(data.order, gql)),
      );
    } catch (err) {
      logger.error(
        {
          storeId,
          err: (err as Error).message,
          orderId: (raw as { id?: string }).id,
        },
        "failed to ingest bulk order",
      );
      throw err; // A partial import must never become a successful sync.
    }
    processed++;
    if (processed % 100 === 0)
      await opts.onProgress?.({
        processed,
        total: opts.total ?? null,
        cursor: null,
      });
  }
  await opts.onProgress?.({
    processed,
    total: opts.total ?? null,
    cursor: null,
  });
  return processed;
}

export function historicalOrdersQuery(since: Date, through?: Date): string {
  return `processed_at:>='${since.toISOString()}'${through ? ` processed_at:<'${through.toISOString()}'` : ""}`;
}

export function incrementalOrdersQuery(since: Date, through?: Date): string {
  // Small overlap protects against clock skew between Shopify and our last sync marker.
  const overlap = new Date(since.getTime() - 5 * 60_000);
  return `updated_at:>='${overlap.toISOString()}'${through ? ` updated_at:<'${through.toISOString()}'` : ""}`;
}
