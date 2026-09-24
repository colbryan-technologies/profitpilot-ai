import { expect, it } from "vitest";
import { containerEnvironment } from "../../deploy/cloudflare/environment";
const bindings = Object.fromEntries(
  [
    "SHOPIFY_API_KEY",
    "SHOPIFY_API_SECRET",
    "SHOPIFY_APP_URL",
    "DATABASE_URL",
    "REDIS_URL",
    "ENCRYPTION_KEY",
    "SHOPIFY_PARTNER_ORG_ID",
    "SHOPIFY_PARTNER_API_ACCESS_TOKEN",
    "SHOPIFY_APP_GID",
    "SHOPIFY_APP_HANDLE",
  ].map((k) => [k, `fixture-${k}`]),
);
it("forwards only allowed settings and fixes staging safety defaults", () => {
  const result = containerEnvironment({
    ...bindings,
    NODE_ENV: "development",
    BILLING_TEST_MODE: "false",
    UNRELATED_SECRET: "hidden",
    WEB: {},
    WORKER_CONCURRENCY: "2",
  });
  expect(result.NODE_ENV).toBe("production");
  expect(result.BILLING_TEST_MODE).toBe("true");
  expect(result.WORKER_CONCURRENCY).toBe("2");
  expect(result).not.toHaveProperty("UNRELATED_SECRET");
  expect(result).not.toHaveProperty("WEB");
});
it("rejects missing settings without exposing supplied values", () => {
  expect(() =>
    containerEnvironment({
      ...bindings,
      DATABASE_URL: "",
      SHOPIFY_API_SECRET: "never-print-this",
    }),
  ).toThrow("Missing container settings: DATABASE_URL");
});
it("passes provider secrets only through the private environment", () => {
  expect(
    containerEnvironment({
      ...bindings,
      AI_PROVIDER: "openai",
      AI_API_KEY: "fixture",
    }),
  ).toMatchObject({ AI_PROVIDER: "openai", AI_API_KEY: "fixture" });
});
