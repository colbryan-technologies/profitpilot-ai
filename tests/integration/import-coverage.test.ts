import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import prisma from "../../app/db.server";
import { ensureStore } from "../../app/services/store.server";
import {
  storedCoverage,
  importWindow,
} from "../../app/services/import-coverage.server";
import { recalculateStore } from "../../app/services/profit/recalc.server";
let storeId: string;
describe.skipIf(process.env.RUN_INTEGRATION_TESTS !== "1")(
  "empty-day import coverage",
  () => {
    beforeAll(async () => {
      const url = new URL(process.env.DATABASE_URL ?? "");
      if (
        !["localhost", "127.0.0.1"].includes(url.hostname) ||
        url.pathname !== "/profitpilot_test"
      )
        throw new Error("Requires isolated local profitpilot_test database");
      storeId = (
        await ensureStore(`coverage-${randomUUID()}.myshopify.com`, {
          scopes: "read_orders,read_all_orders",
          apiVersion: "2025-10",
        })
      ).id;
    });
    afterAll(async () => {
      if (storeId) await prisma.store.delete({ where: { id: storeId } });
      await prisma.$disconnect();
    });
    it("excludes failed/cancelled imports and fills only successful covered days", async () => {
      const now = new Date();
      const recent = new Date(now.getTime() - 3 * 86400000);
      const old = new Date(now.getTime() - 20 * 86400000);
      const window = importWindow("historical", recent, now);
      for (const status of ["FAILED", "CANCELLED"] as const)
        await prisma.syncJob.create({
          data: {
            storeId,
            type: "HISTORICAL_ORDERS",
            status,
            paramsJson: { importWindow: importWindow("historical", old, now) },
          },
        });
      expect((await storedCoverage(storeId, "UTC")).days.size).toBe(0);
      await prisma.syncJob.create({
        data: {
          storeId,
          type: "HISTORICAL_ORDERS",
          status: "COMPLETED",
          paramsJson: { importWindow: window },
          finishedAt: now,
        },
      });
      const coverage = await storedCoverage(storeId, "UTC");
      expect(coverage.days.size).toBe(3);
      const result = await recalculateStore(storeId);
      expect(result).toMatchObject({ orders: 0, days: 3 });
      const snapshots = await prisma.profitSnapshot.findMany({
        where: { storeId },
        orderBy: { date: "asc" },
      });
      expect(snapshots.map((s) => s.date.toISOString().slice(0, 10))).toEqual([
        ...coverage.days,
      ]);
      expect(
        snapshots.every((s) => s.orderCount === 0 && s.netSalesMinor === 0),
      ).toBe(true);
    });
  },
);
