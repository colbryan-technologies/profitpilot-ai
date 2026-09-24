import { beforeEach, describe, it, expect, vi } from "vitest";
const m = vi.hoisted(() => ({ readiness: vi.fn(), snapshot: vi.fn() }));
vi.mock("../../app/db.server", () => ({
  default: { profitSnapshot: { findFirst: m.snapshot } },
}));
vi.mock("../../app/services/report-readiness.server", () => ({
  reportReadiness: m.readiness,
}));
import { savedBriefingState } from "../../app/services/saved-reports.server";
import { CALC_VERSION } from "../../app/domain/profit/types";
const report = {
  storeId: "tenant-a",
  periodStart: new Date("2026-09-10"),
  periodEnd: new Date("2026-09-17"),
  createdAt: new Date("2026-09-17T12:00:00Z"),
  metricsJson: { calcVersion: CALC_VERSION },
};
beforeEach(() => {
  vi.clearAllMocks();
  m.readiness.mockResolvedValue({ ready: true, warnings: [] });
  m.snapshot.mockResolvedValue(null);
});
describe("saved briefing freshness", () => {
  it("permits a current briefing and checks tenant-scoped comparison dates", async () => {
    expect((await savedBriefingState(report)).available).toBe(true);
    expect(m.snapshot).toHaveBeenCalledWith({
      where: {
        storeId: "tenant-a",
        date: { gte: new Date("2026-09-03"), lt: report.periodEnd },
        computedAt: { gt: report.createdAt },
      },
      select: { id: true },
    });
  });
  it("rejects a briefing after source snapshots were rebuilt", async () => {
    m.snapshot.mockResolvedValue({ id: "newer" });
    expect(await savedBriefingState(report)).toMatchObject({
      available: false,
      reason: expect.stringContaining("recalculated"),
    });
  });
  it("rejects a briefing while source data is not ready", async () => {
    m.readiness.mockResolvedValue({ ready: false, warnings: [] });
    expect((await savedBriefingState(report)).available).toBe(false);
  });
  it("rejects legacy calculation versions without needing newer snapshots", async () =>
    expect(
      (
        await savedBriefingState({
          ...report,
          metricsJson: { calcVersion: "old" },
        })
      ).available,
    ).toBe(false));
});
