// Deliberate allowlist: never forward arbitrary Cloudflare bindings or request input.
const required = [
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
] as const;
const optional = [
  "SCOPES",
  "AI_PROVIDER",
  "AI_API_KEY",
  "AI_MODEL_FAST",
  "AI_MODEL_STRONG",
  "AI_TIMEOUT_MS",
  "RATE_LIMIT_PER_MINUTE",
  "WORKER_CONCURRENCY",
  "LOG_LEVEL",
  "PLATFORM_ADMIN_TOKEN",
  "PLATFORM_ADMIN_SHOPS",
  "SENTRY_DSN",
  "META_APP_ID",
  "META_APP_SECRET",
  "GOOGLE_ADS_CLIENT_ID",
  "GOOGLE_ADS_CLIENT_SECRET",
  "GOOGLE_ADS_DEVELOPER_TOKEN",
] as const;
export function containerEnvironment(
  bindings: Record<string, unknown>,
): Record<string, string> {
  const missing = required.filter(
    (k) => typeof bindings[k] !== "string" || !(bindings[k] as string).trim(),
  );
  if (missing.length)
    throw new Error(`Missing container settings: ${missing.join(", ")}`);
  const result: Record<string, string> = {
    NODE_ENV: "production",
    HOST: "0.0.0.0",
    PORT: "3000",
    AI_PROVIDER: "none",
    BILLING_TEST_MODE: "true",
  };
  for (const key of [...required, ...optional]) {
    if (typeof bindings[key] === "string")
      result[key] = bindings[key] as string;
  }
  return result;
}
