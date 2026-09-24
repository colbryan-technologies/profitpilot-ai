/** Date helpers. All period math is done on UTC calendar days derived from the store's timezone. */

export type PeriodKey = "today" | "yesterday" | "7d" | "30d" | "90d" | "mtd" | "last_month" | "ytd" | "custom";

export interface Period {
  key: PeriodKey;
  /** inclusive, UTC midnight */
  start: Date;
  /** exclusive, UTC midnight */
  end: Date;
  label: string;
}

/** Returns the calendar date (YYYY-MM-DD) for `date` in the given IANA timezone. */
export function localDateString(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** UTC midnight Date for a YYYY-MM-DD string. Snapshot dates are stored this way. */
export function dayFromString(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000Z`);
}

export function toYmd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

export function startOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

export function startOfYear(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
}

/** Resolve a period key relative to "today" in the store's timezone. */
export function resolvePeriod(key: PeriodKey, timeZone: string, now = new Date(), custom?: { start: string; end: string }): Period {
  const today = dayFromString(localDateString(now, timeZone));
  const tomorrow = addDays(today, 1);
  switch (key) {
    case "today":
      return { key, start: today, end: tomorrow, label: "Today" };
    case "yesterday":
      return { key, start: addDays(today, -1), end: today, label: "Yesterday" };
    case "7d":
      return { key, start: addDays(today, -6), end: tomorrow, label: "Last 7 days" };
    case "30d":
      return { key, start: addDays(today, -29), end: tomorrow, label: "Last 30 days" };
    case "90d":
      return { key, start: addDays(today, -89), end: tomorrow, label: "Last 90 days" };
    case "mtd":
      return { key, start: startOfMonth(today), end: tomorrow, label: "Month to date" };
    case "last_month": {
      const thisMonth = startOfMonth(today);
      const prev = new Date(Date.UTC(thisMonth.getUTCFullYear(), thisMonth.getUTCMonth() - 1, 1));
      return { key, start: prev, end: thisMonth, label: "Last month" };
    }
    case "ytd":
      return { key, start: startOfYear(today), end: tomorrow, label: "Year to date" };
    case "custom": {
      if (!custom) throw new Error("custom period requires start/end");
      return { key, start: dayFromString(custom.start), end: addDays(dayFromString(custom.end), 1), label: `${custom.start} → ${custom.end}` };
    }
  }
}

/** The immediately preceding period of equal length (for comparisons). */
export function previousPeriod(p: Period): Period {
  const lengthMs = p.end.getTime() - p.start.getTime();
  return { key: p.key, start: new Date(p.start.getTime() - lengthMs), end: p.start, label: `Previous ${p.label.toLowerCase()}` };
}

export function daysBetween(start: Date, end: Date): number {
  return Math.round((end.getTime() - start.getTime()) / 86_400_000);
}

export function eachDay(start: Date, end: Date): Date[] {
  const days: Date[] = [];
  for (let d = start; d < end; d = addDays(d, 1)) days.push(d);
  return days;
}

export function isPeriodKey(value: string | null): value is PeriodKey {
  return ["today", "yesterday", "7d", "30d", "90d", "mtd", "last_month", "ytd", "custom"].includes(value ?? "");
}
