import { describe, expect, it } from "vitest";
import {
  assessReadiness,
  type ReadinessInput,
} from "../../app/services/report-readiness.server";
import { CALC_VERSION } from "../../app/domain/profit/types";
const now = new Date("2026-09-24T12:00:00Z");
const base = (): ReadinessInput => ({
  period: { start: new Date("2026-09-23"), end: new Date("2026-09-25") },
  snapshots: ["2026-09-23", "2026-09-24"].map((d) => ({
    date: new Date(d),
    computedAt: now,
    calcVersion: CALC_VERSION,
  })),
  initialSyncComplete: true,
  lastSync: now,
  pending: 0,
  staleAds: 0,
  now,
});
describe("report readiness", () => {
  it("accepts fully calculated dates with recent synchronization", () =>
    expect(assessReadiness(base()).ready).toBe(true));
  it("does not treat a missing day as zero", () => {
    const b = base();
    b.snapshots.pop();
    expect(assessReadiness(b)).toMatchObject({ ready: false, missingDays: 1 });
  });
  it("does not accept an incremental sync as initial coverage", () =>
    expect(
      assessReadiness({ ...base(), initialSyncComplete: false }).ready,
    ).toBe(false));
  it("blocks stale synchronization", () =>
    expect(
      assessReadiness({ ...base(), lastSync: new Date("2026-09-22") }).ready,
    ).toBe(false));
  it("blocks pending changes", () =>
    expect(assessReadiness({ ...base(), pending: 1 }).ready).toBe(false));
  it("blocks obsolete calculations", () => {
    const b = base();
    b.snapshots[0].calcVersion = "old";
    expect(assessReadiness(b).ready).toBe(false);
  });
  it("warns separately about stale ad spend", () =>
    expect(assessReadiness({ ...base(), staleAds: 1 })).toMatchObject({
      ready: true,
      warnings: [expect.stringContaining("Advertising")],
    }));
  it("checks freshness against the store-local current date", () => {
    const b = base();
    b.now = new Date("2026-09-25T02:00:00Z");
    b.today = new Date("2026-09-24");
    b.snapshots[1].computedAt = new Date("2026-09-23");
    expect(assessReadiness(b).reasons).toContain(
      "Today's figures need recalculation.",
    );
  });
});
