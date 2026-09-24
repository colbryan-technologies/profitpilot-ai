import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  find: vi.fn(),
  update: vi.fn(),
  upsert: vi.fn(),
  audit: vi.fn(),
}));
vi.mock("../../app/db.server", () => ({
  default: {
    subscription: {
      findUnique: mocks.find,
      update: mocks.update,
      upsert: mocks.upsert,
    },
  },
}));
vi.mock("../../app/services/store.server", () => ({ audit: mocks.audit }));
vi.mock("../../app/lib/env.server", () => ({
  env: () => ({
    LOG_LEVEL: "silent",
    SHOPIFY_PARTNER_ORG_ID: "123",
    SHOPIFY_PARTNER_API_ACCESS_TOKEN: "synthetic",
    SHOPIFY_APP_GID: "gid://shopify/App/123",
  }),
}));
import { resolveEntitlements } from "../../app/services/billing.server";
const remote = (value: unknown) =>
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(JSON.stringify(value))),
  );
beforeEach(() => {
  vi.clearAllMocks();
  mocks.find.mockResolvedValue(null);
});
afterEach(() => vi.unstubAllGlobals());
describe("verified billing entitlements", () => {
  it("rejects a missing shop identity even with a paid mirror", async () => {
    mocks.find.mockResolvedValue({ status: "ACTIVE", planKey: "pro" });
    await expect(resolveEntitlements("a", null)).rejects.toThrow("shop ID");
  });
  it("does not treat an incomplete response as a cancellation", async () => {
    remote({});
    await expect(
      resolveEntitlements("a", "gid://shopify/Shop/1"),
    ).rejects.toThrow("missing subscription data");
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("removes paid access when the remote subscription is absent", async () => {
    mocks.find.mockResolvedValue({
      status: "ACTIVE",
      planKey: "pro",
      updatedAt: new Date(0),
    });
    remote({ data: { activeSubscription: null } });
    const result = await resolveEntitlements("a", "gid://shopify/Shop/1");
    expect(result.plan.key).toBe("free");
    expect(result.active).toBe(false);
    expect(mocks.update).toHaveBeenCalled();
  });
  it.each([
    { items: [] },
    { items: [{ handle: "unknown" }] },
    { items: [{ handle: "pro" }, { handle: "growth" }] },
  ])("rejects unmapped or ambiguous pricing items %j", async ({ items }) => {
    remote({ data: { activeSubscription: { items } } });
    await expect(
      resolveEntitlements("a", "gid://shopify/Shop/1"),
    ).rejects.toThrow("not recognized");
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
  it("rechecks a recently cached plan when its billing period has ended", async () => {
    mocks.find.mockResolvedValue({
      status: "ACTIVE",
      planKey: "pro",
      updatedAt: new Date(),
      currentPeriodEnd: new Date(0),
    });
    remote({
      data: { activeSubscription: { items: [{ handle: "starter" }] } },
    });
    expect(
      (await resolveEntitlements("a", "gid://shopify/Shop/1")).plan.key,
    ).toBe("starter");
  });
  it("does not fall back to stale paid access after a billing error", async () => {
    mocks.find.mockResolvedValue({
      status: "ACTIVE",
      planKey: "pro",
      updatedAt: new Date(0),
    });
    remote({ errors: [{ message: "unavailable" }] });
    await expect(
      resolveEntitlements("a", "gid://shopify/Shop/1"),
    ).rejects.toThrow("Partner API request failed");
  });
});
