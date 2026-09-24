import { describe, it, expect, vi } from "vitest";
import {
  consumeRateLimit,
  rateKey,
} from "../../app/services/rate-limit.server";
const redis = (result: unknown) => ({
  eval: vi.fn().mockResolvedValue(result),
});
describe("request rate limit responses", () => {
  it("permits an accepted slot", async () => {
    await expect(
      consumeRateLimit("a", "requests", 5, 60000, redis([1, 60000])),
    ).resolves.toBeUndefined();
  });
  it("returns rounded retry seconds without exposing tenant identity", async () => {
    try {
      await consumeRateLimit(
        "sensitive-shop",
        "briefing",
        1,
        60000,
        redis([0, 1450]),
      );
      throw new Error("expected rejection");
    } catch (err) {
      expect(err).toBeInstanceOf(Response);
      const r = err as Response;
      expect(r.status).toBe(429);
      expect(r.headers.get("Retry-After")).toBe("2");
      expect(await r.text()).not.toContain("sensitive-shop");
    }
  });
  it("fails closed when Redis is unavailable", async () => {
    const r = {
      eval: vi.fn().mockRejectedValue(new Error("secret internal address")),
    };
    await expect(
      consumeRateLimit("a", "requests", 1, 60000, r),
    ).rejects.toMatchObject({ status: 503 });
  });
  it("rejects malformed Redis results", async () => {
    await expect(
      consumeRateLimit("a", "requests", 1, 60000, redis(null)),
    ).rejects.toMatchObject({ status: 503 });
  });
  it("separates tenants and operation types without storing raw IDs", () => {
    expect(rateKey("a", "requests")).not.toBe(rateKey("b", "requests"));
    expect(rateKey("a", "requests")).not.toBe(rateKey("a", "sync"));
    expect(rateKey("tenant.example", "requests")).not.toContain(
      "tenant.example",
    );
  });
});
