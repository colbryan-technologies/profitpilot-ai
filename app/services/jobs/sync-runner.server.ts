import type { SyncJob } from "@prisma/client";
import prisma from "../../db.server";
import { logger } from "../../lib/logger.server";
import { ShopifyGraphqlError } from "../shopify/admin.server";
import {
  countOrders,
  historicalOrdersQuery,
  incrementalOrdersQuery,
  ingestBulkOrders,
  startBulkOrders,
  syncOrdersPaginated,
  syncProducts,
  syncShopInfo,
  waitForBulk,
  type SyncProgress,
} from "../shopify/sync.server";
import { recalculateStore } from "../profit/recalc.server";
import { runLeakDetection } from "../leaks/detect.server";
import {
  enqueueRecalculate,
  enqueueSync,
  type SyncJobData,
} from "./queue.server";

const HISTORY_DAYS_DEFAULT = 365;
const BULK_TIMEOUT_MS = 6 * 3_600_000;

async function progress(
  jobId: string,
  p: Partial<SyncProgress> & { progress?: number },
) {
  await prisma.syncJob.update({
    where: { id: jobId },
    data: {
      ...(p.processed !== undefined ? { processed: p.processed } : {}),
      ...(p.total !== undefined ? { total: p.total } : {}),
      ...(p.cursor !== undefined ? { cursor: p.cursor } : {}),
      ...(p.progress !== undefined
        ? { progress: p.progress }
        : p.total && p.processed !== undefined
          ? {
              progress: Math.min(
                99,
                Math.round((p.processed / Math.max(1, p.total)) * 100),
              ),
            }
          : {}),
    },
  });
}

async function isCancelled(jobId: string): Promise<boolean> {
  const j = await prisma.syncJob.findUnique({
    where: { id: jobId },
    select: { status: true },
  });
  return j?.status === "CANCELLED";
}

/** Entry point for the BullMQ `sync` job. Resumable: reads `cursor` from the SyncJob row. */
export async function runSyncJob(data: SyncJobData): Promise<void> {
  const job = await prisma.syncJob.findUnique({
    where: { id: data.syncJobId },
  });
  if (!job || job.status === "CANCELLED" || job.status === "COMPLETED") return;
  const store = await prisma.store.findUnique({
    where: { id: data.storeId },
    select: { status: true, shopDomain: true },
  });
  if (!store || store.status !== "ACTIVE") {
    await prisma.syncJob.update({
      where: { id: job.id },
      data: {
        status: "CANCELLED",
        finishedAt: new Date(),
        lastError: "Store not active",
      },
    });
    return;
  }
  const log = logger.child({
    syncJobId: job.id,
    storeId: data.storeId,
    type: job.type,
  });
  await prisma.syncJob.update({
    where: { id: job.id },
    data: {
      status: "RUNNING",
      startedAt: job.startedAt ?? new Date(),
      attempts: { increment: 1 },
    },
  });
  log.info("sync job started");

  try {
    switch (job.type) {
      case "SHOP_INFO":
        await syncShopInfo(data.storeId, store.shopDomain);
        if ((job.paramsJson as { initial?: boolean }).initial)
          await enqueueSync(
            data.storeId,
            store.shopDomain,
            "PRODUCTS",
            job.paramsJson as Record<string, unknown>,
          );
        break;
      case "PRODUCTS":
        await runProducts(job, store.shopDomain);
        if ((job.paramsJson as { initial?: boolean }).initial)
          await enqueueSync(
            data.storeId,
            store.shopDomain,
            "HISTORICAL_ORDERS",
            job.paramsJson as Record<string, unknown>,
          );
        break;
      case "HISTORICAL_ORDERS":
        await runHistorical(job, store.shopDomain);
        break;
      case "INCREMENTAL_ORDERS":
        await runIncremental(job, store.shopDomain);
        break;
      case "RECALCULATE":
        await recalculateStore(data.storeId, {
          since: (job.paramsJson as { since?: string | null }).since
            ? new Date((job.paramsJson as { since: string }).since)
            : null,
          onProgress: async (_msg, pct) => progress(job.id, { progress: pct }),
        });
        break;
      case "DETECT_LEAKS":
        await runLeakDetection(data.storeId);
        break;
      default:
        throw new Error(`Unsupported sync job type ${job.type}`);
    }
    if (await isCancelled(job.id)) return;
    await prisma.syncJob.update({
      where: { id: job.id },
      data: {
        status: "COMPLETED",
        progress: 100,
        finishedAt: new Date(),
        lastError: null,
      },
    });
    log.info("sync job completed");
  } catch (err) {
    if (await isCancelled(job.id)) return;
    const message = (err as Error).message;
    const retryable = !(err instanceof ShopifyGraphqlError && !err.retryable);
    await prisma.syncJob.update({
      where: { id: job.id },
      data: {
        status: retryable ? "QUEUED" : "FAILED",
        lastError: message.slice(0, 2000),
        ...(retryable ? {} : { finishedAt: new Date() }),
      },
    });
    log.error({ err: message, retryable }, "sync job failed");
    if (retryable) throw err; // BullMQ retries with backoff; cursor is preserved for resume
  }
}

async function runProducts(job: SyncJob, shopDomain: string) {
  const params = job.paramsJson as { since?: string | null };
  await syncProducts(job.storeId, shopDomain, {
    since: params.since ? new Date(params.since) : null,
    cursor: job.cursor,
    onProgress: (p) => progress(job.id, p),
  });
}

async function runHistorical(job: SyncJob, shopDomain: string) {
  const params = job.paramsJson as {
    days?: number;
    mode?: "bulk" | "paginated";
    bulkId?: string | null;
  };
  const since = new Date(
    Date.now() - (params.days ?? HISTORY_DAYS_DEFAULT) * 86_400_000,
  );
  const query = historicalOrdersQuery(since);
  const total = job.total ?? (await countOrders(shopDomain, query));
  if (total !== null && job.total === null) await progress(job.id, { total });

  const preferBulk =
    params.mode !== "paginated" && (total === null || total > 250);
  let bulkId =
    params.bulkId ??
    (job.cursor?.startsWith("gid://shopify/BulkOperation/")
      ? job.cursor
      : null);

  if (preferBulk) {
    if (!bulkId) bulkId = await startBulkOrders(shopDomain, query);
    if (bulkId) {
      await prisma.syncJob.update({
        where: { id: job.id },
        data: { cursor: bulkId, paramsJson: { ...params, bulkId } },
      });
      const status = await waitForBulk(shopDomain, bulkId, {
        timeoutMs: BULK_TIMEOUT_MS,
        onTick: async (s) => {
          if (await isCancelled(job.id)) throw new Error("Cancelled");
          await progress(job.id, {
            progress:
              s.status === "RUNNING"
                ? Math.min(
                    30,
                    5 +
                      Math.round(
                        (Number(s.objectCount ?? 0) / Math.max(1, total ?? 1)) *
                          25,
                      ),
                  )
                : 5,
          });
        },
      });
      if (status.status === "COMPLETED" && status.url) {
        await ingestBulkOrders(job.storeId, status.url, {
          total,
          onProgress: (p) =>
            progress(job.id, {
              processed: p.processed,
              progress: total
                ? Math.min(
                    95,
                    30 + Math.round((p.processed / Math.max(1, total)) * 65),
                  )
                : undefined,
            }),
        });
        await afterOrderSync(job.storeId, shopDomain, since);
        return;
      }
      logger.warn(
        {
          syncJobId: job.id,
          status: status.status,
          errorCode: status.errorCode,
        },
        "bulk operation did not complete — falling back to pagination",
      );
      await prisma.syncJob.update({
        where: { id: job.id },
        data: {
          cursor: null,
          paramsJson: { ...params, mode: "paginated", bulkId: null },
        },
      });
    }
  }

  const cursor = job.cursor?.startsWith("gid://") ? null : job.cursor;
  await syncOrdersPaginated(job.storeId, shopDomain, {
    query,
    cursor,
    total,
    onProgress: (p) =>
      progress(job.id, { ...p, processed: (job.processed ?? 0) + p.processed }),
    shouldStop: () => isCancelled(job.id),
  });
  await afterOrderSync(job.storeId, shopDomain, since);
}

async function runIncremental(job: SyncJob, shopDomain: string) {
  const last = await prisma.syncJob.findFirst({
    where: {
      storeId: job.storeId,
      type: { in: ["HISTORICAL_ORDERS", "INCREMENTAL_ORDERS"] },
      status: "COMPLETED",
      id: { not: job.id },
    },
    orderBy: { startedAt: "desc" },
    select: { startedAt: true },
  });
  const since = last?.startedAt ?? new Date(Date.now() - 86_400_000);
  const query = incrementalOrdersQuery(since);
  const result = await syncOrdersPaginated(job.storeId, shopDomain, {
    query,
    cursor: job.cursor,
    onProgress: (p) => progress(job.id, p),
    shouldStop: () => isCancelled(job.id),
  });
  await syncProducts(job.storeId, shopDomain, { since });
  if (result.processed > 0)
    await afterOrderSync(job.storeId, shopDomain, since);
}

async function afterOrderSync(
  storeId: string,
  _shopDomain: string,
  since: Date,
) {
  void since;
  // An order updated today may have been placed years ago. The worker runs
  // detection after this rebuild, so alerts cannot race ahead of snapshots.
  await enqueueRecalculate(storeId, null);
}

/** Kick off the full initial import for a freshly installed store. */
export async function startInitialSync(
  storeId: string,
  shopDomain: string,
  days = HISTORY_DAYS_DEFAULT,
) {
  await enqueueSync(storeId, shopDomain, "SHOP_INFO", { initial: true, days });
}

/** Called by the scheduler: queue incremental syncs for every active store. */
export async function scheduleIncrementalForAllStores(): Promise<number> {
  const stores = await prisma.store.findMany({
    where: {
      status: "ACTIVE",
      syncJobs: { some: { type: "HISTORICAL_ORDERS", status: "COMPLETED" } },
    },
    select: { id: true, shopDomain: true },
  });
  for (const s of stores)
    await enqueueSync(s.id, s.shopDomain, "INCREMENTAL_ORDERS");
  return stores.length;
}
