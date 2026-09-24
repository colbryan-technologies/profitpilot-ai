import prisma from "../db.server";
import { addDays, dayFromString, localDateString } from "../lib/dates";
export type ImportWindow = {
  version: 1;
  kind: "historical" | "incremental";
  since: string;
  through: string;
};
export function importWindow(
  kind: ImportWindow["kind"],
  since: Date,
  through: Date,
): ImportWindow {
  if (
    !Number.isFinite(since.getTime()) ||
    !Number.isFinite(through.getTime()) ||
    since >= through
  )
    throw new Error("Invalid import window");
  return {
    version: 1,
    kind,
    since: since.toISOString(),
    through: through.toISOString(),
  };
}
export function coverageIntervals(values: unknown[]) {
  const windows: ImportWindow[] = [];
  for (const value of values) {
    const w = (value as { importWindow?: ImportWindow } | null)?.importWindow;
    if (
      !w ||
      w.version !== 1 ||
      !["historical", "incremental"].includes(w.kind)
    )
      continue;
    try {
      windows.push(
        importWindow(w.kind, new Date(w.since), new Date(w.through)),
      );
    } catch {
      /* Legacy or corrupt metadata is not evidence. */
    }
  }
  const ranges = windows
    .filter((w) => w.kind === "historical")
    .map((w) => ({ start: new Date(w.since), end: new Date(w.through) }));
  // Updated-order scans can extend an existing baseline, never create one.
  for (const w of windows
    .filter((w) => w.kind === "incremental")
    .sort((a, b) => a.since.localeCompare(b.since))) {
    const start = new Date(w.since),
      end = new Date(w.through);
    for (const r of ranges) if (start <= r.end && end > r.end) r.end = end;
  }
  ranges.sort((a, b) => a.start.getTime() - b.start.getTime());
  const merged: typeof ranges = [];
  for (const r of ranges) {
    const last = merged.at(-1);
    if (last && r.start <= last.end) {
      if (r.end > last.end) last.end = r.end;
    } else merged.push({ ...r });
  }
  return merged;
}
export function coveredCalendarDays(
  ranges: Array<{ start: Date; end: Date }>,
  timeZone: string,
  now = new Date(),
) {
  const days = new Set<string>();
  const today = localDateString(now, timeZone);
  for (const range of ranges) {
    // Exclude the partial first day conservatively, even for an exact midnight.
    let d = addDays(dayFromString(localDateString(range.start, timeZone)), 1);
    const end = dayFromString(localDateString(range.end, timeZone));
    while (
      d < end ||
      (d.getTime() === end.getTime() &&
        localDateString(range.end, timeZone) === today)
    ) {
      days.add(d.toISOString().slice(0, 10));
      d = addDays(d, 1);
    }
  }
  return days;
}
export async function storedCoverage(
  storeId: string,
  timeZone: string,
  now = new Date(),
) {
  const jobs = await prisma.syncJob.findMany({
    where: {
      storeId,
      status: "COMPLETED",
      type: { in: ["HISTORICAL_ORDERS", "INCREMENTAL_ORDERS"] },
    },
    select: { paramsJson: true },
  });
  const ranges = coverageIntervals(jobs.map((j) => j.paramsJson));
  return { ranges, days: coveredCalendarDays(ranges, timeZone, now) };
}
