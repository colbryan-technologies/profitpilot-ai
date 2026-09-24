import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import prisma from "../../app/db.server";
import { ensureStore } from "../../app/services/store.server";
import {
  monthlyOrderUsage,
  orderHistoryBounds,
  requireReportPeriod,
} from "../../app/services/report-access.server";
import { resolvePeriod } from "../../app/lib/dates";
import { buildGrounding } from "../../app/services/ai/grounding.server";
let storeId: string;
describe.skipIf(process.env.RUN_INTEGRATION_TESTS !== "1")(
  "report history access",
  () => {
    beforeAll(async () => {
      const url = new URL(process.env.DATABASE_URL ?? "");
      if (
        !["localhost", "127.0.0.1"].includes(url.hostname) ||
        url.pathname !== "/profitpilot_test"
      )
        throw new Error("Requires isolated local profitpilot_test database");
      storeId = (
        await ensureStore(`history-${randomUUID()}.myshopify.com`, {
          scopes: "read_orders",
          apiVersion: "2025-10",
        })
      ).id;
      await prisma.store.update({
        where: { id: storeId },
        data: { ianaTimezone: "America/New_York" },
      });
    });
    afterAll(async () => {
      if (storeId) await prisma.store.delete({ where: { id: storeId } });
      await prisma.$disconnect();
    });
    it("converts local history boundaries across daylight saving correctly", async () => {
      const b = await orderHistoryBounds(
        storeId,
        new Date("2026-03-20T12:00:00Z"),
      );
      expect(b.start.toISOString()).toBe("2026-02-19T05:00:00.000Z");
      expect(b.end.toISOString()).toBe("2026-03-21T04:00:00.000Z");
    });
    it("rejects free 90-day reports and allows the full period after upgrade", async () => {
      const period = resolvePeriod("90d", "America/New_York");
      await expect(requireReportPeriod(storeId, period)).rejects.toMatchObject({
        status: 403,
      });
      await prisma.subscription.update({
        where: { storeId },
        data: { planKey: "starter" },
      });
      await expect(requireReportPeriod(storeId, period)).resolves.toMatchObject(
        { historyDays: 90 },
      );
      await prisma.subscription.update({
        where: { storeId },
        data: { planKey: "free" },
      });
      await expect(requireReportPeriod(storeId, period)).rejects.toMatchObject({
        status: 403,
      });
    });
    it("omits inaccessible comparisons instead of inventing zero previous profit", async () => {
      const g = await buildGrounding(storeId, "30d");
      expect(g.deltas.netProfit.previous).toBe(
        "Unavailable under current history allowance",
      );
      expect(g.deltas.netProfit.changePct).toBeNull();
      expect(g.drivers).toEqual([]);
      expect(g.dataNotes.join(" ")).toContain("no comparison was calculated");
    });
    it("counts a complete local month without test or prior-month orders", async () => {
      const stamp = new Date("2026-03-01T05:00:00Z");
      const base = {
        storeId,
        name: "Synthetic",
        currency: "USD",
        processedAt: stamp,
        shopifyCreatedAt: stamp,
        shopifyUpdatedAt: stamp,
        subtotalMinor: 100,
        totalDiscountsMinor: 0,
        totalShippingMinor: 0,
        totalTaxMinor: 0,
        totalPriceMinor: 100,
      };
      await prisma.order.createMany({
        data: [
          ...Array.from({ length: 101 }, (_, n) => ({
            ...base,
            shopifyId: `fixture-${n}`,
          })),
          { ...base, shopifyId: "test", isTest: true },
          {
            ...base,
            shopifyId: "previous",
            processedAt: new Date("2026-03-01T04:59:59Z"),
          },
        ],
      });
      await expect(
        monthlyOrderUsage(storeId, new Date("2026-03-20T12:00:00Z")),
      ).resolves.toEqual({
        count: 101,
        limit: 100,
        exceeded: true,
        month: "2026-03",
      });
      expect(await prisma.order.count({ where: { storeId } })).toBe(103);
    });
  },
);
