import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import prisma from "../../app/db.server";
import { ensureStore } from "../../app/services/store.server";
import { reserveAskUsage } from "../../app/services/billing.server";
let storeId: string;
describe.skipIf(process.env.RUN_INTEGRATION_TESTS !== "1")(
  "atomic Ask allowance",
  () => {
    beforeAll(async () => {
      const url = new URL(process.env.DATABASE_URL ?? "");
      if (
        !["localhost", "127.0.0.1"].includes(url.hostname) ||
        url.pathname !== "/profitpilot_test"
      )
        throw new Error("Requires isolated local profitpilot_test database");
      storeId = (
        await ensureStore(`quota-${randomUUID()}.myshopify.com`, {
          scopes: "read_orders",
          apiVersion: "2025-10",
        })
      ).id;
    });
    afterAll(async () => {
      if (storeId) await prisma.store.delete({ where: { id: storeId } });
      await prisma.$disconnect();
    });
    it("admits only the remaining slots under concurrent requests", async () => {
      const data = {
        storeId,
        feature: "ask",
        provider: "none",
        model: "fixture",
        inputTokens: 0,
        outputTokens: 0,
        costMicros: 0,
        latencyMs: 0,
        success: false,
      };
      await prisma.aiUsage.createMany({
        data: Array.from({ length: 8 }, () => data),
      });
      const results = await Promise.allSettled(
        Array.from({ length: 6 }, () => reserveAskUsage(storeId)),
      );
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
      for (const result of results)
        if (result.status === "rejected")
          expect(result.reason.status).toBe(429);
      expect(
        await prisma.aiUsage.count({ where: { storeId, feature: "ask" } }),
      ).toBe(10);
    });
    it("allows a slot again once a reservation falls outside the rolling day", async () => {
      const row = await prisma.aiUsage.findFirstOrThrow({ where: { storeId } });
      await prisma.aiUsage.update({
        where: { id: row.id },
        data: { createdAt: new Date(Date.now() - 86_401_000) },
      });
      await expect(reserveAskUsage(storeId)).resolves.toMatchObject({
        model: "reserved",
      });
    });
  },
);
