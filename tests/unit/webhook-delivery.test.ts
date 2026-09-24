import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  findUnique: vi.fn(),
  enqueue: vi.fn(),
}));
vi.mock("../../app/db.server", () => ({
  default: {
    webhookEvent: { create: mocks.create, findUnique: mocks.findUnique },
  },
}));
vi.mock("../../app/lib/logger.server", () => ({ logger: { info: vi.fn() } }));
vi.mock("../../app/services/store.server", () => ({
  getStoreByDomain: async () => ({ id: "store-1" }),
  audit: vi.fn(),
  markUninstalled: vi.fn(),
  redactCustomer: vi.fn(),
  redactStore: vi.fn(),
}));
vi.mock("../../app/services/jobs/queue.server", () => ({
  enqueueWebhook: mocks.enqueue,
  enqueueSync: vi.fn(),
  scheduleDebouncedRecalc: vi.fn(),
}));
vi.mock("../../app/services/shopify/sync.server", () => ({
  syncSingleOrder: vi.fn(),
  syncSingleProduct: vi.fn(),
}));
import {
  minimalWebhookPayload,
  recordWebhook,
} from "../../app/services/shopify/webhooks.server";

const input = {
  webhookId: "delivery-1",
  topic: "ORDERS_UPDATED",
  shopDomain: "example.myshopify.com",
  payload: { id: 123 },
};

describe("durable webhook delivery", () => {
  beforeEach(() => vi.resetAllMocks());
  it("discards customer details and tokens while retaining dispatch identifiers", () => {
    expect(
      minimalWebhookPayload({
        id: 123,
        email: "private@example.com",
        accessToken: "secret",
        customer: { id: 456, email: "private@example.com" },
        billing_address: { address1: "private" },
      }),
    ).toEqual({ id: 123, customer: { id: 456 } });
  });
  it("keeps requested order IDs for a privacy request without retaining customer contact details", () => {
    expect(
      minimalWebhookPayload({
        customer: { id: 456, email: "private@example.com", phone: "private" },
        data_request: { id: 123 },
        orders_requested: [42, "43"],
      }),
    ).toEqual({
      customer: { id: 456 },
      data_request: { id: 123 },
      orders_requested: [42, "43"],
    });
  });
  it("recovers a persisted event after initial queue delivery fails", async () => {
    mocks.create
      .mockResolvedValueOnce({ id: "event-1" })
      .mockRejectedValueOnce({ code: "P2002" });
    mocks.enqueue
      .mockRejectedValueOnce(new Error("Redis unavailable"))
      .mockResolvedValueOnce(undefined);
    mocks.findUnique.mockResolvedValue({ id: "event-1", status: "RECEIVED" });
    await expect(recordWebhook(input)).rejects.toThrow("Redis unavailable");
    await expect(recordWebhook(input)).resolves.toBe(false);
    expect(mocks.enqueue).toHaveBeenNthCalledWith(2, "event-1");
  });
  it.each(["PROCESSED", "IGNORED", "DEAD_LETTER"])(
    "does not replay a %s duplicate",
    async (status) => {
      mocks.create.mockRejectedValue({ code: "P2002" });
      mocks.findUnique.mockResolvedValue({ id: "event-1", status });
      await expect(recordWebhook(input)).resolves.toBe(false);
      expect(mocks.enqueue).not.toHaveBeenCalled();
    },
  );
  it("does not acknowledge a duplicate when delivery still fails", async () => {
    mocks.create.mockRejectedValue({ code: "P2002" });
    mocks.findUnique.mockResolvedValue({ id: "event-1", status: "RECEIVED" });
    mocks.enqueue.mockRejectedValue(new Error("Redis unavailable"));
    await expect(recordWebhook(input)).rejects.toThrow("Redis unavailable");
  });
});
