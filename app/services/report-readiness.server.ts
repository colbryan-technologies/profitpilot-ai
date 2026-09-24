import prisma from "../db.server";
import { CALC_VERSION } from "../domain/profit/types";
import {
  type Period,
  addDays,
  dayFromString,
  localDateString,
} from "../lib/dates";

export interface ReadinessInput {
  period: Pick<Period, "start" | "end">;
  snapshots: Array<{ date: Date; computedAt: Date; calcVersion: string }>;
  initialSyncComplete: boolean;
  lastSync: Date | null;
  pending: number;
  staleAds: number;
  now?: Date;
  today?: Date;
}
/** Conservative display gate; missing dates are not evidence of zero activity. */
export function assessReadiness(input: ReadinessInput) {
  const reasons: string[] = [];
  const warnings: string[] = [];
  if (!input.initialSyncComplete)
    reasons.push("Initial order synchronization has not completed.");
  const now = input.now ?? new Date();
  if (
    !input.lastSync ||
    now.getTime() - input.lastSync.getTime() > 24 * 3_600_000
  )
    reasons.push("Order synchronization is missing or more than 24 hours old.");
  if (input.pending)
    reasons.push("Order, cost or calculation work is pending or failed.");
  const dates = new Set(
    input.snapshots.map((s) => s.date.toISOString().slice(0, 10)),
  );
  let missingDays = 0;
  for (let d = input.period.start; d < input.period.end; d = addDays(d, 1))
    if (!dates.has(d.toISOString().slice(0, 10))) missingDays++;
  if (missingDays)
    reasons.push(
      `${missingDays} day(s) have no calculated snapshot. Missing days are not treated as zero profit.`,
    );
  if (input.snapshots.some((s) => s.calcVersion !== CALC_VERSION))
    reasons.push("Some figures use an older calculation version.");
  // Today's snapshot requires regular refresh even when there are no order changes.
  if (
    input.snapshots.some(
      (s) =>
        now.getTime() - s.computedAt.getTime() > 24 * 3_600_000 &&
        s.date.getTime() ===
          (input.today ?? dayFromString(localDateString(now, "UTC"))).getTime(),
    )
  )
    reasons.push("Today's figures need recalculation.");
  if (input.staleAds)
    warnings.push(
      "Advertising synchronization is stale, disconnected or awaiting attention; recorded spend may be incomplete.",
    );
  return { ready: reasons.length === 0, reasons, warnings, missingDays };
}
export async function reportReadiness(
  storeId: string,
  period: Pick<Period, "start" | "end">,
  now = new Date(),
) {
  const [snapshots, initial, lastSync, lastRecalc, adAccounts, store] =
    await Promise.all([
      prisma.profitSnapshot.findMany({
        where: { storeId, date: { gte: period.start, lt: period.end } },
        select: { date: true, computedAt: true, calcVersion: true },
      }),
      prisma.syncJob.findFirst({
        where: { storeId, type: "HISTORICAL_ORDERS", status: "COMPLETED" },
        select: { id: true },
      }),
      prisma.syncJob.findFirst({
        where: {
          storeId,
          type: { in: ["HISTORICAL_ORDERS", "INCREMENTAL_ORDERS"] },
          status: "COMPLETED",
        },
        orderBy: { finishedAt: "desc" },
        select: { finishedAt: true },
      }),
      prisma.syncJob.findFirst({
        where: { storeId, type: "RECALCULATE", status: "COMPLETED" },
        orderBy: { finishedAt: "desc" },
        select: { finishedAt: true },
      }),
      prisma.adAccount.findMany({
        where: {
          storeId,
          provider: { not: "MANUAL" },
        },
        select: { status: true, lastSyncedAt: true },
      }),
      prisma.store.findUniqueOrThrow({
        where: { id: storeId },
        select: { ianaTimezone: true },
      }),
    ]);
  const pending = await prisma.syncJob.count({
    where: {
      storeId,
      type: {
        in: [
          "HISTORICAL_ORDERS",
          "INCREMENTAL_ORDERS",
          "PRODUCTS",
          "RECALCULATE",
          "AD_SPEND",
        ],
      },
      OR: [
        { status: { in: ["QUEUED", "RUNNING"] } },
        {
          status: "FAILED",
          updatedAt: { gt: lastRecalc?.finishedAt ?? new Date(0) },
        },
      ],
    },
  });
  return assessReadiness({
    period,
    today: dayFromString(localDateString(now, store.ianaTimezone)),
    snapshots,
    initialSyncComplete: !!initial,
    lastSync: lastSync?.finishedAt ?? null,
    pending,
    staleAds: adAccounts.filter(
      (a) =>
        a.status !== "CONNECTED" ||
        !a.lastSyncedAt ||
        now.getTime() - a.lastSyncedAt.getTime() > 36 * 3_600_000,
    ).length,
    now,
  });
}
export async function requireReadyReport(
  storeId: string,
  period: Pick<Period, "start" | "end">,
) {
  const status = await reportReadiness(storeId, period);
  if (!status.ready)
    throw new Response(
      `Report data is not ready. ${status.reasons.join(" ")} Check Data health.`,
      { status: 503 },
    );
  return status;
}
