import prisma from "../db.server";
import { storeEntitlements } from "./billing.server";
import {
  addDays,
  dayFromString,
  localDateString,
  startOfMonth,
  type Period,
} from "../lib/dates";

export function historyWindow(
  historyDays: number,
  timeZone: string,
  now = new Date(),
) {
  const end = addDays(dayFromString(localDateString(now, timeZone)), 1);
  return { start: addDays(end, -historyDays), end };
}
export function includesPeriod(
  window: { start: Date; end: Date },
  period: Pick<Period, "start" | "end">,
) {
  return (
    Number.isFinite(period.start.getTime()) &&
    Number.isFinite(period.end.getTime()) &&
    period.start < period.end &&
    period.start >= window.start &&
    period.end <= window.end
  );
}
export async function reportWindow(storeId: string, now = new Date()) {
  const [store, { plan }] = await Promise.all([
    prisma.store.findUniqueOrThrow({
      where: { id: storeId },
      select: { ianaTimezone: true },
    }),
    storeEntitlements(storeId),
  ]);
  return {
    ...historyWindow(plan.historyDays, store.ianaTimezone, now),
    historyDays: plan.historyDays,
    orderLimit: plan.orderLimit,
    timeZone: store.ianaTimezone,
  };
}
export async function requireReportPeriod(
  storeId: string,
  period: Pick<Period, "start" | "end">,
) {
  const window = await reportWindow(storeId);
  if (!includesPeriod(window, period))
    throw new Response(
      `This period is outside your plan's ${window.historyDays}-day history. Choose a shorter period or manage your plan in Billing.`,
      { status: 403 },
    );
  return window;
}
/** Convert the store's local date boundaries to instants before filtering orders. */
export async function orderHistoryBounds(storeId: string, now = new Date()) {
  const window = await reportWindow(storeId, now);
  return localBounds(window.start, window.end, window.timeZone);
}
async function localBounds(start: Date, end: Date, timeZone: string) {
  const [bounds] = await prisma.$queryRaw<Array<{ start: Date; end: Date }>>`
    SELECT (${start.toISOString().slice(0, 10)}::date::timestamp AT TIME ZONE ${timeZone}) AS start,
           (${end.toISOString().slice(0, 10)}::date::timestamp AT TIME ZONE ${timeZone}) AS end`;
  return bounds;
}

/** Stored non-test orders in the current store-local calendar month, not a charge meter. */
export async function monthlyOrderUsage(storeId: string, now = new Date()) {
  const window = await reportWindow(storeId, now);
  const start = startOfMonth(addDays(window.end, -1));
  const bounds = await localBounds(start, window.end, window.timeZone);
  const count = await prisma.order.count({
    where: {
      storeId,
      isTest: false,
      processedAt: { gte: bounds.start, lt: bounds.end },
    },
  });
  return {
    count,
    limit: window.orderLimit,
    exceeded: window.orderLimit !== null && count > window.orderLimit,
    month: start.toISOString().slice(0, 7),
  };
}
