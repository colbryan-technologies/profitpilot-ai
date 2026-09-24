import { afterEach, describe, expect, it, vi } from "vitest";
import { assertProductionEnv, env, type Env } from "../../app/lib/env.server";
const valid = (): Env => ({
  ...env(),
  NODE_ENV: "production",
  SHOPIFY_API_KEY: "synthetic-key",
  SHOPIFY_API_SECRET: "synthetic-secret",
  SHOPIFY_APP_URL: "https://profitpilot.test",
  DATABASE_URL: "postgresql://test:test@localhost:5432/test",
  REDIS_URL: "redis://localhost:6379",
  ENCRYPTION_KEY: Buffer.from(Array.from({ length: 32 }, (_, i) => i)).toString(
    "hex",
  ),
  SHOPIFY_PARTNER_ORG_ID: "123",
  SHOPIFY_PARTNER_API_ACCESS_TOKEN: "synthetic-partner-token",
  SHOPIFY_APP_GID: "gid://shopify/App/123",
  SHOPIFY_APP_HANDLE: "profitpilot-ai",
  AI_PROVIDER: "none",
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});
describe("production configuration", () => {
  it("accepts configured production and development environments", () => {
    expect(() => assertProductionEnv(valid())).not.toThrow();
    expect(() =>
      assertProductionEnv({
        ...valid(),
        NODE_ENV: "development",
        ENCRYPTION_KEY: "",
      }),
    ).not.toThrow();
  });
  it.each([
    "SHOPIFY_API_SECRET",
    "ENCRYPTION_KEY",
    "SHOPIFY_PARTNER_API_ACCESS_TOKEN",
  ] as const)("rejects missing %s without revealing secrets", (field) => {
    expect(() => assertProductionEnv({ ...valid(), [field]: "" })).toThrow(
      field,
    );
  });
  it.each([
    "http://profitpilot.test",
    "https://localhost",
    "https://your-app.example.com",
    "https://user:private@profitpilot.test",
  ])("rejects an unsafe app URL", (url) => {
    expect(() =>
      assertProductionEnv({ ...valid(), SHOPIFY_APP_URL: url }),
    ).toThrow("SHOPIFY_APP_URL");
  });
  it.each(["garbage", "0".repeat(64), "a".repeat(80)])(
    "rejects malformed encryption keys",
    (key) => {
      expect(() =>
        assertProductionEnv({ ...valid(), ENCRYPTION_KEY: key }),
      ).toThrow("ENCRYPTION_KEY");
    },
  );
  it("rejects enabled AI without a key and placeholder pricing configuration", () => {
    expect(() =>
      assertProductionEnv({
        ...valid(),
        AI_PROVIDER: "openai",
        AI_API_KEY: "",
      }),
    ).toThrow("AI_API_KEY");
    expect(() =>
      assertProductionEnv({
        ...valid(),
        SHOPIFY_APP_GID: "gid://shopify/App/0",
      }),
    ).toThrow("SHOPIFY_APP_GID");
  });
  it("automatically rejects incomplete production configuration when env is loaded", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SHOPIFY_API_SECRET", "");
    const fresh = await import("../../app/lib/env.server");
    expect(() => fresh.env()).toThrow("production environment");
  });
  it("does not echo invalid environment values in errors", async () => {
    vi.stubEnv("AI_PROVIDER", "private-value-not-to-log");
    const fresh = await import("../../app/lib/env.server");
    try {
      fresh.env();
      throw new Error("Expected invalid environment");
    } catch (error) {
      expect((error as Error).message).toContain("AI_PROVIDER");
      expect((error as Error).message).not.toContain(
        "private-value-not-to-log",
      );
    }
  });
});
