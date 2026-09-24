import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import prisma from "../../app/db.server";
import {
  ensureStore,
  redactCustomer,
  redactStore,
} from "../../app/services/store.server";
import { upsertOrder } from "../../app/services/shopify/persist.server";
import type { MappedOrder } from "../../app/services/shopify/mappers";

const enabled = process.env.RUN_INTEGRATION_TESTS === "1";
const suffix = randomUUID();
const shops = [
  `tenant-a-${suffix}.myshopify.com`,
  `tenant-b-${suffix}.myshopify.com`,
];
let stores: Awaited<ReturnType<typeof ensureStore>>[] = [];
const timestamp = new Date("2026-09-24T00:00:00Z");
function mapped(name: string): MappedOrder {
  return {
    order: {
      shopifyId: "gid://shopify/Order/1",
      name,
      orderNumber: 1,
      processedAt: timestamp,
      shopifyCreatedAt: timestamp,
      shopifyUpdatedAt: timestamp,
      cancelledAt: null,
      closedAt: null,
      financialStatus: "PAID",
      fulfillmentStatus: "FULFILLED",
      currency: "USD",
      customerShopifyId: "gid://shopify/Customer/1",
      isTest: false,
      sourceName: "test",
      subtotalMinor: 1000,
      totalDiscountsMinor: 0,
      totalShippingMinor: 0,
      totalTaxMinor: 0,
      totalTipMinor: 0,
      totalDutiesMinor: 0,
      totalPriceMinor: 1000,
      totalRefundedMinor: 0,
      taxesIncluded: false,
      shippingCountryCode: "US",
    },
    lineItems: [
      {
        shopifyId: "gid://shopify/LineItem/1",
        shopifyProductId: null,
        shopifyVariantId: null,
        title: "Fixture",
        sku: null,
        quantity: 1,
        currentQuantity: 1,
        unitPriceMinor: 1000,
        discountMinor: 0,
        taxMinor: 0,
        requiresShipping: false,
        isGiftCard: false,
      },
    ],
    refunds: [],
    transactions: [],
  };
}

describe.skipIf(!enabled)("PostgreSQL tenant persistence and redaction", () => {
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    if (
      !["localhost", "127.0.0.1"].includes(url.hostname) ||
      url.pathname !== "/profitpilot_test"
    )
      throw new Error(
        "Integration tests require the isolated local profitpilot_test database",
      );
    stores = await Promise.all(
      shops.map((shop) =>
        ensureStore(shop, { scopes: "read_orders", apiVersion: "2025-10" }),
      ),
    );
  });
  afterAll(async () => {
    if (stores.length) {
      await prisma.webhookEvent.deleteMany({ where: { webhookId: suffix } });
      await prisma.organization.deleteMany({
        where: { id: { in: stores.map((s) => s.organizationId) } },
      });
      await prisma.session.deleteMany({ where: { shop: { in: shops } } });
    }
    await prisma.$disconnect();
  });
  it("creates installation defaults and persists identical Shopify IDs independently per tenant", async () => {
    expect(stores.every((s) => s.aiEnabled === false)).toBe(true);
    await upsertOrder(stores[0].id, mapped("A"));
    await upsertOrder(stores[1].id, mapped("B"));
    await upsertOrder(stores[0].id, mapped("A revised"));
    const a = await prisma.order.findMany({
      where: { storeId: stores[0].id },
      include: { lineItems: true },
    });
    const b = await prisma.order.findMany({
      where: { storeId: stores[1].id },
      include: { lineItems: true },
    });
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a[0].name).toBe("A revised");
    expect(b[0].name).toBe("B");
    expect(a[0].lineItems).toHaveLength(1);
    expect(b[0].lineItems).toHaveLength(1);
    expect(a[0].lineItems[0].id).not.toBe(b[0].lineItems[0].id);
  });
  it("scopes customer redaction to the requested tenant", async () => {
    await redactCustomer(stores[0].id, ["gid://shopify/Customer/1"], []);
    expect(await prisma.order.count({ where: { storeId: stores[0].id } })).toBe(
      0,
    );
    expect(
      await prisma.lineItem.count({ where: { storeId: stores[0].id } }),
    ).toBe(0);
    expect(
      (
        await prisma.order.findFirstOrThrow({
          where: { storeId: stores[1].id },
        })
      ).customerShopifyId,
    ).toBe("gid://shopify/Customer/1");
  });
  it("blocks replay, force import and customer-less replay of an erased order", async () => {
    expect(
      await upsertOrder(stores[0].id, mapped("Replay"), { force: true }),
    ).toEqual({ orderId: null, changed: false });
    const withoutCustomer = mapped("Replay without customer");
    withoutCustomer.order.customerShopifyId = null;
    expect((await upsertOrder(stores[0].id, withoutCustomer)).changed).toBe(
      false,
    );
    const newOrder = mapped("New ID for erased customer");
    newOrder.order.shopifyId = "gid://shopify/Order/99";
    expect((await upsertOrder(stores[0].id, newOrder)).changed).toBe(false);
    expect(
      await prisma.erasureMarker.count({ where: { storeId: stores[0].id } }),
    ).toBe(2);
    expect(
      await prisma.syncJob.count({
        where: { storeId: stores[0].id, type: "RECALCULATE", status: "QUEUED" },
      }),
    ).toBe(1);
    expect(
      await redactCustomer(stores[0].id, ["gid://shopify/Customer/1"], []),
    ).toBe(0);
  });
  it("serializes concurrent ingestion and erasure without restoring deleted data", async () => {
    const incoming = mapped("Concurrent");
    incoming.order.shopifyId = "gid://shopify/Order/77";
    incoming.order.customerShopifyId = "gid://shopify/Customer/77";
    incoming.lineItems[0].shopifyId = "gid://shopify/LineItem/77";
    await Promise.all([
      upsertOrder(stores[0].id, incoming),
      redactCustomer(
        stores[0].id,
        ["gid://shopify/Customer/77"],
        [incoming.order.shopifyId],
      ),
    ]);
    expect(
      await prisma.order.count({
        where: { storeId: stores[0].id, shopifyId: incoming.order.shopifyId },
      }),
    ).toBe(0);
    expect((await upsertOrder(stores[0].id, incoming)).changed).toBe(false);
  });
  it("order-only erasure does not suppress unrelated orders for the same customer", async () => {
    const erased = mapped("Order-only");
    erased.order.shopifyId = "gid://shopify/Order/88";
    erased.order.customerShopifyId = "gid://shopify/Customer/88";
    erased.lineItems[0].shopifyId = "gid://shopify/LineItem/88";
    await upsertOrder(stores[0].id, erased);
    await redactCustomer(stores[0].id, [], [erased.order.shopifyId]);
    expect((await upsertOrder(stores[0].id, erased)).changed).toBe(false);
    const retained = mapped("Other order");
    retained.order.shopifyId = "gid://shopify/Order/89";
    retained.order.customerShopifyId = erased.order.customerShopifyId;
    retained.lineItems[0].shopifyId = "gid://shopify/LineItem/89";
    expect((await upsertOrder(stores[0].id, retained)).changed).toBe(true);
  });
  it("deletes tenant data and sessions, scrubs webhook payloads, and preserves the other store", async () => {
    await prisma.webhookEvent.create({
      data: {
        storeId: stores[0].id,
        shopDomain: shops[0],
        webhookId: suffix,
        topic: "ORDERS_CREATE",
        payload: { customer: { id: "test-customer" } },
      },
    });
    await prisma.auditEvent.create({
      data: { storeId: stores[0].id, actorType: "system", action: "test" },
    });
    await prisma.session.create({
      data: {
        id: `offline_${shops[0]}`,
        shop: shops[0],
        state: "test",
        accessToken: "synthetic-test-token",
      },
    });
    expect(await redactStore(shops[0])).toBe(true);
    expect(await prisma.order.count({ where: { storeId: stores[0].id } })).toBe(
      0,
    );
    expect(
      await prisma.lineItem.count({ where: { storeId: stores[0].id } }),
    ).toBe(0);
    expect(
      await prisma.auditEvent.count({ where: { storeId: stores[0].id } }),
    ).toBe(0);
    expect(await prisma.session.count({ where: { shop: shops[0] } })).toBe(0);
    const event = await prisma.webhookEvent.findUniqueOrThrow({
      where: { webhookId: suffix },
    });
    expect(event.payload).toEqual({});
    expect(event.shopDomain).toBe("[redacted]");
    expect(event.storeId).toBeNull();
    expect(await prisma.order.count({ where: { storeId: stores[1].id } })).toBe(
      1,
    );
  });
});
