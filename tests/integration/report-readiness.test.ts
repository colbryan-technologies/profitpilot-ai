import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import prisma from "../../app/db.server";
import { ensureStore } from "../../app/services/store.server";
import {
  reportReadiness,
  requireReadyReport,
} from "../../app/services/report-readiness.server";
import { rebuildSnapshots } from "../../app/services/profit/recalc.server";
import { resolvePeriod } from "../../app/lib/dates";
let storeId: string;
const period = resolvePeriod("today", "UTC");
describe.skipIf(process.env.RUN_INTEGRATION_TESTS !== "1")(
  "report readiness persistence",
  () => {
    beforeAll(async () => {
      const url = new URL(process.env.DATABASE_URL ?? "");
      if (
        !["localhost", "127.0.0.1"].includes(url.hostname) ||
        url.pathname !== "/profitpilot_test"
      )
        throw new Error("Requires isolated local profitpilot_test database");
      storeId = (
        await ensureStore(`readiness-${randomUUID()}.myshopify.com`, {
          scopes: "read_orders",
          apiVersion: "2025-10",
        })
      ).id;
    });
    afterAll(async () => {
      if (storeId) await prisma.store.delete({ where: { id: storeId } });
      await prisma.$disconnect();
    });
    it("blocks an uninitialized store", async () => {
      await expect(requireReadyReport(storeId, period)).rejects.toMatchObject({
        status: 503,
      });
    });
    it("accepts an explicit calculated zero day after initial sync", async () => {
      await prisma.syncJob.create({
        data: {
          storeId,
          type: "HISTORICAL_ORDERS",
          status: "COMPLETED",
          finishedAt: new Date(),
        },
      });
      await rebuildSnapshots(storeId, [
        period.start.toISOString().slice(0, 10),
      ]);
      expect((await reportReadiness(storeId, period)).ready).toBe(true);
    });
    it("blocks a pending recalculation and clears after completion", async () => {
      const job = await prisma.syncJob.create({
        data: { storeId, type: "RECALCULATE", status: "QUEUED" },
      });
      expect((await reportReadiness(storeId, period)).ready).toBe(false);
      await prisma.syncJob.update({
        where: { id: job.id },
        data: { status: "COMPLETED", finishedAt: new Date() },
      });
      expect((await reportReadiness(storeId, period)).ready).toBe(true);
    });
    it("does not substitute a partial range for all requested dates", async () => {
      const start = new Date(period.start.getTime() - 86400000);
      expect(
        await reportReadiness(storeId, { start, end: period.end }),
      ).toMatchObject({ ready: false, missingDays: 1 });
    });
  },
);
