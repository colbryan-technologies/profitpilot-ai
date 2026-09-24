import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  feature: vi.fn(),
  period: vi.fn(),
  ready: vi.fn(),
  limit: vi.fn(),
  find: vi.fn(),
  existing: vi.fn(),
  save: vi.fn(),
  ground: vi.fn(),
  state: vi.fn(),
}));
vi.mock("../../app/db.server", () => ({
  default: {
    store: {
      findUniqueOrThrow: vi.fn(async () => ({
        ianaTimezone: "Pacific/Auckland",
        aiEnabled: false,
      })),
    },
    intelligenceDigest: {
      findFirst: m.find,
      findUnique: m.existing,
      upsert: m.save,
    },
  },
}));
vi.mock("../../app/services/billing.server", () => ({
  requirePlanFeature: m.feature,
}));
vi.mock("../../app/services/report-access.server", () => ({
  requireReportPeriod: m.period,
}));
vi.mock("../../app/services/report-readiness.server", () => ({
  requireReadyReport: m.ready,
}));
vi.mock("../../app/services/rate-limit.server", () => ({
  consumeRateLimit: m.limit,
}));
vi.mock("../../app/services/saved-reports.server", () => ({
  savedBriefingState: m.state,
}));
vi.mock("../../app/services/ai/grounding.server", () => ({
  buildGrounding: m.ground,
}));
import { generateWeeklyDigest } from "../../app/services/ai/digest.server";
const archived = {
  id: "old",
  storeId: "store-a",
  periodStart: new Date("2026-08-01"),
  periodEnd: new Date("2026-08-08"),
  summary: "old text",
};
beforeEach(() => {
  vi.resetAllMocks();
  m.find.mockResolvedValue(archived);
  m.existing.mockResolvedValue(archived);
  m.state.mockResolvedValue({ available: false });
  m.save.mockResolvedValue({ id: "old" });
  m.ground.mockResolvedValue({
    period: { start: "2026-08-01", end: "2026-08-08" },
    metrics: { netProfit: "$10", netSales: "$20", orders: 1 },
    deltas: { netProfit: { changePct: null } },
    drivers: [],
    openLeaks: [],
    confidence: { label: "Low", score: 10, caveats: [] },
    allowedNumbers: [],
  });
});
it("refreshes the original week with tenant-scoped selection and unchanged row identity", async () => {
  await generateWeeklyDigest("store-a", "old");
  expect(m.find).toHaveBeenCalledWith({
    where: { id: "old", storeId: "store-a", kind: "WEEKLY" },
  });
  expect(m.ground).toHaveBeenCalledWith("store-a", "custom", {
    start: "2026-08-01",
    end: "2026-08-07",
  });
  expect(m.save.mock.calls[0][0]).toMatchObject({
    where: {
      storeId_kind_periodStart: {
        storeId: "store-a",
        kind: "WEEKLY",
        periodStart: archived.periodStart,
      },
    },
    update: { periodEnd: archived.periodEnd },
  });
  expect(m.limit).toHaveBeenCalledWith("store-a", "briefing", 1, 300000);
});
it("rejects missing or another tenant's briefing before generation", async () => {
  m.find.mockResolvedValue(null);
  await expect(generateWeeklyDigest("store-b", "old")).rejects.toMatchObject({
    status: 404,
  });
  expect(m.ground).not.toHaveBeenCalled();
  expect(m.save).not.toHaveBeenCalled();
});
it("enforces current plan history even for a cached briefing", async () => {
  m.period.mockRejectedValue(new Response("Outside history", { status: 403 }));
  m.state.mockResolvedValue({ available: true });
  await expect(generateWeeklyDigest("store-a", "old")).rejects.toMatchObject({
    status: 403,
  });
  expect(m.ground).not.toHaveBeenCalled();
});
it("preserves the saved briefing when source data is unavailable", async () => {
  m.ready.mockRejectedValue(new Response("Not ready", { status: 503 }));
  await expect(generateWeeklyDigest("store-a", "old")).rejects.toMatchObject({
    status: 503,
  });
  expect(m.save).not.toHaveBeenCalled();
});
it("reuses a fresh briefing without consuming a generation slot", async () => {
  m.state.mockResolvedValue({ available: true });
  expect(await generateWeeklyDigest("store-a", "old")).toEqual({
    id: "old",
    summary: "old text",
  });
  expect(m.limit).not.toHaveBeenCalled();
});
it("rejects malformed saved periods", async () => {
  m.find.mockResolvedValue({ ...archived, periodEnd: new Date("2026-08-09") });
  await expect(generateWeeklyDigest("store-a", "old")).rejects.toMatchObject({
    status: 400,
  });
  expect(m.save).not.toHaveBeenCalled();
});
