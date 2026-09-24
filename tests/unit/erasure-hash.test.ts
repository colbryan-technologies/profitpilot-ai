import { describe, expect, it } from "vitest";
import { erasureHash } from "../../app/lib/crypto.server";
describe("erasure suppression hashes", () => {
  it("is stable without exposing the resource identifier", () => {
    const hash = erasureHash("store-a", "gid://shopify/Customer/123");
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).toBe(erasureHash("store-a", "gid://shopify/Customer/123"));
  });
  it("separates stores and resource types", () => {
    const hash = erasureHash("store-a", "gid://shopify/Customer/123");
    expect(hash).not.toBe(erasureHash("store-b", "gid://shopify/Customer/123"));
    expect(hash).not.toBe(erasureHash("store-a", "gid://shopify/Order/123"));
  });
});
