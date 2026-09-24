/**
 * Background worker. Run separately from the web process:
 *   pnpm worker:dev   (development, tsx watch)
 *   pnpm worker       (production, built output)
 */
import { Worker, type Job } from "bullmq";
import { env } from "../app/lib/env.server";
import { logger } from "../app/lib/logger.server";
import prisma from "../app/db.server";
import {
  QUEUE_NAME,
  redis,
  registerSchedules,
  recoverPendingDelivery,
  type JobData,
  type JobName,
  type RecalculateJobData,
  type StoreJobData,
  type SyncJobData,
  type WebhookJobData,
} from "../app/services/jobs/queue.server";
import {
  runSyncJob,
  scheduleIncrementalForAllStores,
} from "../app/services/jobs/sync-runner.server";
import { processWebhookEvent } from "../app/services/shopify/webhooks.server";
import { recalculateStore } from "../app/services/profit/recalc.server";
import { runLeakDetection } from "../app/services/leaks/detect.server";
import { syncAllAdAccounts } from "../app/services/ads/sync.server";
import { runDueDigests } from "../app/services/ai/digest.server";

env();

async function handle(job: Job<JobData, unknown, JobName>) {
  const log = logger.child({
    jobId: job.id,
    name: job.name,
    attempt: job.attemptsMade + 1,
  });
  log.info("job started");
  const started = Date.now();
  switch (job.name) {
    case "recover-delivery":
      await recoverPendingDelivery();
      break;
    case "sync":
      await runSyncJob(job.data as SyncJobData);
      break;
    case "webhook":
      await processWebhookEvent((job.data as WebhookJobData).webhookEventId);
      break;
    case "recalculate": {
      const d = job.data as RecalculateJobData;
      const store = await prisma.store.findUnique({
        where: { id: d.storeId },
        select: { status: true },
      });
      if (!store || store.status !== "ACTIVE") return;
      if (d.syncJobId) {
        await prisma.syncJob.update({
          where: { id: d.syncJobId },
          data: { status: "RUNNING", startedAt: new Date() },
        });
      }
      try {
        await recalculateStore(d.storeId, {
          since: d.since ? new Date(d.since) : null,
          onProgress: d.syncJobId
            ? async (_m, pct) =>
                void (await prisma.syncJob.update({
                  where: { id: d.syncJobId! },
                  data: { progress: pct },
                }))
            : undefined,
        });
        if (d.syncJobId)
          await prisma.syncJob.update({
            where: { id: d.syncJobId },
            data: {
              status: "COMPLETED",
              progress: 100,
              finishedAt: new Date(),
            },
          });
        await runLeakDetection(d.storeId);
      } catch (err) {
        if (d.syncJobId)
          await prisma.syncJob.update({
            where: { id: d.syncJobId },
            data: {
              status: "FAILED",
              lastError: (err as Error).message.slice(0, 2000),
              finishedAt: new Date(),
            },
          });
        throw err;
      }
      break;
    }
    case "detect-leaks":
      await runLeakDetection((job.data as StoreJobData).storeId);
      break;
    case "schedule-incremental": {
      const n = await scheduleIncrementalForAllStores();
      log.info({ stores: n }, "incremental syncs scheduled");
      break;
    }
    case "ad-spend":
      await syncAllAdAccounts();
      break;
    case "digest":
      await runDueDigests();
      break;
    default:
      throw new Error(`Unknown job ${job.name}`);
  }
  log.info({ ms: Date.now() - started }, "job finished");
}

async function main() {
  const concurrency = Number(process.env.WORKER_CONCURRENCY ?? 5);
  const worker = new Worker<JobData, unknown, JobName>(QUEUE_NAME, handle, {
    connection: redis(),
    concurrency,
    lockDuration: 120_000,
    stalledInterval: 60_000,
  });
  worker.on("failed", (job, err) =>
    logger.error(
      {
        jobId: job?.id,
        name: job?.name,
        attempt: job?.attemptsMade,
        err: err.message,
      },
      "job failed",
    ),
  );
  worker.on("failed", (job) => {
    if (job?.name !== "sync" || job.attemptsMade < (job.opts.attempts ?? 1))
      return;
    const data = job.data as SyncJobData;
    void prisma.syncJob
      .updateMany({
        where: { id: data.syncJobId, status: { in: ["QUEUED", "RUNNING"] } },
        data: { status: "FAILED", finishedAt: new Date() },
      })
      .catch(() => logger.error("failed to persist exhausted sync status"));
  });
  worker.on("error", (err) =>
    logger.error({ err: err.message }, "worker error"),
  );
  await registerSchedules();
  logger.info({ concurrency, queue: QUEUE_NAME }, "worker ready");

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "worker shutting down");
    await worker.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  logger.fatal({ err: (err as Error).message }, "worker crashed");
  process.exit(1);
});
