import type { IntelligenceDigest } from "@prisma/client";
import prisma from "../db.server";
import { CALC_VERSION } from "../domain/profit/types";
import { reportReadiness } from "./report-readiness.server";

export async function savedBriefingState(
  report: Pick<
    IntelligenceDigest,
    "storeId" | "periodStart" | "periodEnd" | "createdAt" | "metricsJson"
  >,
) {
  const period = {
    start: new Date(report.periodStart.getTime() - 7 * 86_400_000),
    end: report.periodEnd,
  };
  const readiness = await reportReadiness(report.storeId, period);
  const newer = await prisma.profitSnapshot.findFirst({
    where: {
      storeId: report.storeId,
      date: { gte: period.start, lt: period.end },
      computedAt: { gt: report.createdAt },
    },
    select: { id: true },
  });
  const version = (report.metricsJson as { calcVersion?: string } | null)
    ?.calcVersion;
  const stale = !!newer || version !== CALC_VERSION;
  return {
    available: readiness.ready && !stale,
    reason: !readiness.ready
      ? "Source data is not ready. Check Data health before relying on this briefing."
      : stale
        ? "The figures have been recalculated since this briefing. A refreshed briefing is needed."
        : null,
    warnings: readiness.warnings,
  };
}
