import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
vi.mock("../../app/lib/crypto.server", () => ({
  encrypt: () => "synthetic-encrypted-fixture",
  decrypt: () => {
    throw new Error("Provider credentials must not be read in blocked sync");
  },
}));
import prisma from "../../app/db.server";
import { ensureStore } from "../../app/services/store.server";
import { requirePlanFeature } from "../../app/services/billing.server";
import {
  connectAdAccount,
  syncAdAccount,
} from "../../app/services/ads/sync.server";
import { generateWeeklyDigest } from "../../app/services/ai/digest.server";
import { exportCogsCsv } from "../../app/services/cogs.server";
import {
  saveNotificationPrefs,
  notificationSchema,
} from "../../app/services/settings.server";
let storeId: string;
async function plan(planKey: string) {
  await prisma.subscription.upsert({
    where: { storeId },
    create: { storeId, planKey },
    update: { planKey, status: "ACTIVE" },
  });
}
const info = (externalId: string) => ({
  externalId,
  name: "Synthetic account",
  currency: "USD",
});
describe.skipIf(process.env.RUN_INTEGRATION_TESTS !== "1")(
  "paid feature enforcement",
  () => {
    beforeAll(async () => {
      const url = new URL(process.env.DATABASE_URL ?? "");
      if (
        !["localhost", "127.0.0.1"].includes(url.hostname) ||
        url.pathname !== "/profitpilot_test"
      )
        throw new Error("Requires isolated local profitpilot_test database");
      storeId = (
        await ensureStore(`features-${randomUUID()}.myshopify.com`, {
          scopes: "read_orders",
          apiVersion: "2025-10",
        })
      ).id;
    });
    afterAll(async () => {
      if (storeId) await prisma.store.delete({ where: { id: storeId } });
      await prisma.$disconnect();
    });
    it("blocks free digest generation, enabling and CSV export at the service boundary", async () => {
      await plan("free");
      await expect(generateWeeklyDigest(storeId)).rejects.toMatchObject({
        status: 403,
      });
      await expect(exportCogsCsv(storeId)).rejects.toMatchObject({
        status: 403,
      });
      await expect(
        saveNotificationPrefs(
          storeId,
          notificationSchema.parse({ weeklyDigest: "on" }),
        ),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        saveNotificationPrefs(
          storeId,
          notificationSchema.parse({ weeklyDigest: false }),
        ),
      ).resolves.toBeUndefined();
      expect(
        await prisma.intelligenceDigest.count({ where: { storeId } }),
      ).toBe(0);
    });
    it("allows paid feature checks and CSV export", async () => {
      await plan("starter");
      await expect(
        requirePlanFeature(storeId, "digest"),
      ).resolves.toMatchObject({ plan: { key: "starter" } });
      await expect(exportCogsCsv(storeId)).resolves.toContain("variant_id,sku");
    });
    it("admits only one connected account under concurrent Starter requests", async () => {
      const results = await Promise.allSettled(
        ["a", "b", "c"].map((id) =>
          connectAdAccount(storeId, "META", info(id), {
            accessToken: "synthetic",
          }),
        ),
      );
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      for (const r of results)
        if (r.status === "rejected") expect(r.reason.status).toBe(403);
      const account = await prisma.adAccount.findFirstOrThrow({
        where: { storeId },
      });
      await expect(
        connectAdAccount(storeId, "META", info(account.externalId), {
          accessToken: "synthetic",
        }),
      ).resolves.toMatchObject({ id: account.id });
    });
    it("blocks reconnect and background sync after a downgrade without deleting spend", async () => {
      await plan("free");
      const account = await prisma.adAccount.findFirstOrThrow({
        where: { storeId },
      });
      await expect(
        connectAdAccount(storeId, "META", info(account.externalId), {
          accessToken: "synthetic",
        }),
      ).rejects.toMatchObject({ status: 403 });
      await expect(syncAdAccount(account.id)).resolves.toEqual({ days: 0 });
      expect(await prisma.adAccount.count({ where: { storeId } })).toBe(1);
      await expect(requirePlanFeature(storeId, "digest")).rejects.toMatchObject(
        { status: 403 },
      );
    });
    it("keeps the oldest allowed account renewable after a partial downgrade", async () => {
      await plan("growth");
      const oldest = await prisma.adAccount.findFirstOrThrow({
        where: { storeId },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      const extra = await connectAdAccount(storeId, "GOOGLE", info("extra"), {
        accessToken: "synthetic",
      });
      await plan("starter");
      await expect(
        connectAdAccount(storeId, oldest.provider, info(oldest.externalId), {
          accessToken: "synthetic",
        }),
      ).resolves.toMatchObject({ id: oldest.id });
      await expect(
        connectAdAccount(storeId, "GOOGLE", info("extra"), {
          accessToken: "synthetic",
        }),
      ).rejects.toMatchObject({ status: 403 });
      await expect(syncAdAccount(extra.id)).resolves.toEqual({ days: 0 });
    });
  },
);
