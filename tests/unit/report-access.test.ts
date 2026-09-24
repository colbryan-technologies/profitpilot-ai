import { describe, expect, it } from "vitest";
import {
  historyWindow,
  includesPeriod,
} from "../../app/services/report-access.server";
import { resolvePeriod } from "../../app/lib/dates";
describe("plan history windows", () => {
  it("includes all 30 local dates across a UTC month boundary", () => {
    const now = new Date("2026-03-01T00:30:00Z");
    const window = historyWindow(30, "America/Los_Angeles", now);
    expect(window.start.toISOString()).toBe("2026-01-30T00:00:00.000Z");
    expect(window.end.toISOString()).toBe("2026-03-01T00:00:00.000Z");
    expect(
      includesPeriod(window, resolvePeriod("30d", "America/Los_Angeles", now)),
    ).toBe(true);
    expect(
      includesPeriod(window, resolvePeriod("90d", "America/Los_Angeles", now)),
    ).toBe(false);
  });
  it("rejects partial, future, reversed and invalid periods", () => {
    const window = historyWindow(30, "UTC", new Date("2026-09-24T12:00:00Z"));
    for (const [start, end] of [
      ["2026-08-25", "2026-09-01"],
      ["2026-09-24", "2026-09-26"],
      ["2026-09-10", "2026-09-09"],
      ["invalid", "invalid"],
    ])
      expect(
        includesPeriod(window, { start: new Date(start), end: new Date(end) }),
      ).toBe(false);
    expect(includesPeriod(window, window)).toBe(true);
  });
});
