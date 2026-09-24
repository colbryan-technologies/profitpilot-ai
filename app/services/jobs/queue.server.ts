import { Queue, type JobsOptions } from "bullmq";
import IORedis from "ioredis";
import type { SyncJobType } from "@prisma/client";
import prisma from "../../db.server";
import { env } from "../../lib/env.server";
import { logger } from "../../lib/logger.server";

export const QUEUE_NAME = "profitpilot";

export type JobName =
  | "sync"
  | "webhook"
  | "recalculate"
  | "detect-leaks"
  | "digest"
  | "ad-spend"
  | "schedule-incremental"
  | "recover-delivery";

export interface SyncJobData {
  storeId: string;
  shopDomain: string;
  syncJobId: string;
  type: SyncJobType;
}
export interface WebhookJobData {
  webhookEventId: string;
}
export interface RecalculateJobData {
  storeId: string;
  since?: string | null;
  syncJobId?: string;
}
export interface StoreJobData {
  storeId: string;
}

export type JobData =
  | SyncJobData
  | WebhookJobData
  | RecalculateJobData
  | StoreJobData
  | Record<string, never>;

let connection: IORedis | null = null;
export function redis(): IORedis {
  if (!connection) {
    connection = new IORedis(env().REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
    connection.on("error", (err) =>
      logger.error({ err: err.message }, "redis error"),
    );
  }
  return connection;
}

let queue: Queue<JobData, unknown, JobName> | null = null;
let producer: IORedis | null = null;
export function jobQueue(): Queue<JobData, unknown, JobName> {
  if (!queue) {
    // HTTP producers must fail promptly during outages. Workers use redis()
    // with unlimited retries, as required for blocking connections.
    producer = new IORedis(env().REDIS_URL, {
      maxRetriesPerRequest: 1,
      connectTimeout: 2_000,
      commandTimeout: 2_000,
    });
    producer.on("error", () =>
      logger.warn("queue producer connection unavailable"),
    );
    queue = new Queue<JobData, unknown, JobName>(QUEUE_NAME, {
      connection: producer,
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: "exponential", delay: 5_000 },
        removeOnComplete: { age: 24 * 3600, count: 5_000 },
        removeOnFail: { age: 7 * 24 * 3600 },
      },
    });
  }
  return queue;
}

/**
 * Create a SyncJob row and enqueue it. Duplicate-safe: if a job of the same
 * type is already queued/running for the store, that job is returned instead.
 */
export async function enqueueSync(
  storeId: string,
  shopDomain: string,
  type: SyncJobType,
  params: Record<string, unknown> = {},
  opts: JobsOptions = {},
) {
  const active = await prisma.syncJob.findFirst({
    where: { storeId, type, status: { in: ["QUEUED", "RUNNING"] } },
  });
  if (active) {
    await deliverSync(active.id, storeId, shopDomain, type);
    return active;
  }
  const job = await prisma.syncJob.create({
    data: { storeId, type, paramsJson: JSON.parse(JSON.stringify(params)) },
  });
  await deliverSync(job.id, storeId, shopDomain, type, opts);
  return job;
}

async function deliverSync(
  syncJobId: string,
  storeId: string,
  shopDomain: string,
  type: SyncJobType,
  opts: JobsOptions = {},
) {
  await jobQueue().add(
    "sync",
    { storeId, shopDomain, syncJobId, type },
    { ...opts, jobId: `sync-${syncJobId}` },
  );
}

export async function enqueueWebhook(webhookEventId: string) {
  await jobQueue().add(
    "webhook",
    { webhookEventId },
    { jobId: `webhook-${webhookEventId}`, attempts: 8 },
  );
}

export async function enqueueRecalculate(
  storeId: string,
  since: Date | null = null,
  opts: JobsOptions = {},
) {
  const job = await prisma.syncJob.create({
    data: {
      storeId,
      type: "RECALCULATE",
      paramsJson: { since: since?.toISOString() ?? null },
    },
  });
  await jobQueue().add(
    "recalculate",
    { storeId, since: since?.toISOString() ?? null, syncJobId: job.id },
    { ...opts, jobId: `recalc-${job.id}` },
  );
  return job;
}

export async function enqueueLeakDetection(storeId: string) {
  await jobQueue().add(
    "detect-leaks",
    { storeId },
    { jobId: `leaks-${storeId}-${Math.floor(Date.now() / 600_000)}` },
  );
}

/** Coalesce many webhook-triggered changes into a single recalculation shortly after. */
export async function scheduleDebouncedRecalc(
  storeId: string,
  since: Date | null,
) {
  void since;
  const bucket = Math.floor(Date.now() / 120_000);
  // A later event in the same bucket may affect an older order. Never let the
  // first event's date hide subsequent refunds or deletions.
  await jobQueue().add(
    "recalculate",
    { storeId, since: null },
    {
      jobId: `recalc-debounced-${storeId}-${bucket}`,
      delay: 90_000,
      attempts: 3,
    },
  );
}

/** Recover durable rows whose initial database-to-Redis delivery failed. */
export async function recoverPendingDelivery() {
  const cutoff = new Date(Date.now() - 60_000);
  const events = await prisma.webhookEvent.findMany({
    where: { status: "RECEIVED", receivedAt: { lt: cutoff } },
    orderBy: { receivedAt: "asc" },
    take: 500,
  });
  for (const event of events) await enqueueWebhook(event.id);
  const jobs = await prisma.syncJob.findMany({
    where: {
      status: "QUEUED",
      updatedAt: { lt: cutoff },
      store: { status: "ACTIVE" },
    },
    include: { store: { select: { shopDomain: true } } },
    orderBy: { updatedAt: "asc" },
    take: 500,
  });
  for (const job of jobs) {
    if (job.type === "RECALCULATE") {
      const params = job.paramsJson as { since?: string | null };
      await jobQueue().add(
        "recalculate",
        {
          storeId: job.storeId,
          syncJobId: job.id,
          since: params.since ?? null,
        },
        { jobId: `recalc-${job.id}` },
      );
    } else {
      await deliverSync(job.id, job.storeId, job.store.shopDomain, job.type);
    }
  }
}

/** Register repeatable jobs (call once from the worker on boot). */
export async function registerSchedules() {
  const q = jobQueue();
  await q.upsertJobScheduler(
    "recover-delivery",
    { every: 60_000 },
    { name: "recover-delivery", data: {} },
  );
  await q.upsertJobScheduler(
    "schedule-incremental",
    { every: 15 * 60_000 },
    { name: "schedule-incremental", data: {} },
  );
  await q.upsertJobScheduler(
    "ad-spend",
    { pattern: "15 */6 * * *" },
    { name: "ad-spend", data: {} },
  );
  await q.upsertJobScheduler(
    "digest",
    { pattern: "0 * * * *" },
    { name: "digest", data: {} },
  );
}

export async function queueHealth(): Promise<{
  ok: boolean;
  waiting: number;
  active: number;
  failed: number;
  delayed: number;
}> {
  try {
    const counts = await jobQueue().getJobCounts(
      "waiting",
      "active",
      "failed",
      "delayed",
    );
    return {
      ok: true,
      waiting: counts.waiting ?? 0,
      active: counts.active ?? 0,
      failed: counts.failed ?? 0,
      delayed: counts.delayed ?? 0,
    };
  } catch {
    return { ok: false, waiting: 0, active: 0, failed: 0, delayed: 0 };
  }
}
