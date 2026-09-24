import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import prisma from "../../app/db.server";
import {
  ensureStore,
  redactCustomer,
  redactStore,
} from "../../app/services/store.server";
import {
  fulfillPrivacyRequest,
  privacyExportPage,
  recordPrivacyRequest,
} from "../../app/services/privacy.server";

const enabled = process.env.RUN_INTEGRATION_TESTS === "1";
const suffix = randomUUID();
const domains = [
  `privacy-a-${suffix}.myshopify.com`,
  `privacy-b-${suffix}.myshopify.com`,
];
let stores: Awaited<ReturnType<typeof ensureStore>>[] = [];
const receivedAt = new Date("2026-09-24T12:00:00Z");
const payload = {
  data_request: { id: 123 },
  customer: { id: 456 },
  orders_requested: [42],
};

describe.skipIf(!enabled)(
  "privacy request persistence and access boundaries",
  () => {
    beforeAll(async () => {
      const url = new URL(process.env.DATABASE_URL ?? "");
      if (
        !["localhost", "127.0.0.1"].includes(url.hostname) ||
        url.pathname !== "/profitpilot_test"
      )
        throw new Error("Isolated test database required");
      stores = await Promise.all(
        domains.map((domain) =>
          ensureStore(domain, { scopes: "read_orders", apiVersion: "2025-10" }),
        ),
      );
      for (const store of stores) {
        for (const [id, customer] of [
          [42, 456],
          [43, 456],
          [44, 999],
        ]) {
          await prisma.order.create({
            data: {
              storeId: store.id,
              shopifyId: `gid://shopify/Order/${id}`,
              customerShopifyId: `gid://shopify/Customer/${customer}`,
              name: `#${id}`,
              processedAt: receivedAt,
              shopifyCreatedAt: receivedAt,
              shopifyUpdatedAt: receivedAt,
              currency: "USD",
              subtotalMinor: 1000,
              totalDiscountsMinor: 0,
              totalShippingMinor: 0,
              totalTaxMinor: 0,
              totalPriceMinor: 1000,
              totalRefundedMinor: 0,
            },
          });
        }
      }
    });
    afterAll(async () => {
      if (stores.length) {
        await prisma.webhookEvent.deleteMany({
          where: { webhookId: `orphan-${suffix}` },
        });
        await prisma.organization.deleteMany({
          where: { id: { in: stores.map((s) => s.organizationId) } },
        });
        await prisma.session.deleteMany({ where: { shop: { in: domains } } });
      }
      await prisma.$disconnect();
    });

    it("records retries once, preserves the receipt deadline, and exports only this tenant's matching orders", async () => {
      const r = await recordPrivacyRequest(stores[0].id, payload, receivedAt);
      const retry = await recordPrivacyRequest(
        stores[0].id,
        payload,
        new Date("2026-10-01T00:00:00Z"),
      );
      expect(retry.id).toBe(r.id);
      expect(retry.dueAt.toISOString()).toBe("2026-10-24T12:00:00.000Z");
      const page = await privacyExportPage(stores[0].id, r.id);
      expect(page.orders.map((o) => o.shopifyId).sort()).toEqual([
        "gid://shopify/Order/42",
        "gid://shopify/Order/43",
      ]);
      expect(page.orders.every((o) => o.storeId === stores[0].id)).toBe(true);
      await expect(privacyExportPage(stores[1].id, r.id)).rejects.toMatchObject(
        { status: 404 },
      );
      await expect(
        fulfillPrivacyRequest(stores[1].id, r.id),
      ).rejects.toMatchObject({ status: 404 });
    });
    it("does not reopen a fulfilled request and clears customer lookup identifiers", async () => {
      const r = await recordPrivacyRequest(stores[0].id, payload, receivedAt);
      await fulfillPrivacyRequest(stores[0].id, r.id);
      const retry = await recordPrivacyRequest(
        stores[0].id,
        payload,
        new Date(),
      );
      expect(retry.status).toBe("FULFILLED");
      expect(retry.customerShopifyId).toBeNull();
      expect(retry.requestedOrderShopifyIds).toEqual([]);
      await expect(privacyExportPage(stores[0].id, r.id)).rejects.toMatchObject(
        { status: 404 },
      );
    });
    it("exports no orders for a request without stored matching identifiers", async () => {
      const r = await recordPrivacyRequest(
        stores[0].id,
        { data_request: { id: 124 } },
        receivedAt,
      );
      expect(await privacyExportPage(stores[0].id, r.id)).toEqual({
        orders: [],
        nextCursor: null,
      });
    });
    it("redaction revokes matching request exports without affecting another store", async () => {
      const a = await recordPrivacyRequest(
        stores[0].id,
        { ...payload, data_request: { id: 125 } },
        receivedAt,
      );
      const b = await recordPrivacyRequest(stores[1].id, payload, receivedAt);
      await redactCustomer(stores[0].id, ["gid://shopify/Customer/456"], []);
      await expect(privacyExportPage(stores[0].id, a.id)).rejects.toMatchObject(
        { status: 404 },
      );
      expect((await privacyExportPage(stores[1].id, b.id)).orders).toHaveLength(
        2,
      );
    });
    it("store deletion removes requests and replay scrubs orphan webhook/session records", async () => {
      await redactStore(domains[0]);
      expect(
        await prisma.privacyRequest.count({ where: { storeId: stores[0].id } }),
      ).toBe(0);
      await prisma.webhookEvent.create({
        data: {
          shopDomain: domains[0],
          webhookId: `orphan-${suffix}`,
          topic: "SHOP_REDACT",
          payload: { private: "synthetic" },
        },
      });
      await prisma.session.create({
        data: {
          id: `orphan-${suffix}`,
          shop: domains[0],
          state: "test",
          accessToken: "synthetic-token",
        },
      });
      expect(await redactStore(domains[0])).toBe(false);
      expect(await prisma.session.count({ where: { shop: domains[0] } })).toBe(
        0,
      );
      const event = await prisma.webhookEvent.findUniqueOrThrow({
        where: { webhookId: `orphan-${suffix}` },
      });
      expect(event.payload).toEqual({});
      expect(event.shopDomain).toBe("[redacted]");
      expect(
        await prisma.privacyRequest.count({ where: { storeId: stores[1].id } }),
      ).toBe(1);
    });
  },
);
