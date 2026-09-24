import { z } from "zod";

const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  SHOPIFY_API_KEY: z.string().default(""),
  SHOPIFY_API_SECRET: z.string().default(""),
  SHOPIFY_APP_URL: z.string().default("http://localhost:3000"),
  SCOPES: z
    .string()
    .default("read_orders,read_all_orders,read_products,read_inventory"),
  DATABASE_URL: z.string().default(""),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  /** 32-byte hex/base64 key for AES-256-GCM encryption of integration credentials. */
  ENCRYPTION_KEY: z.string().default(""),
  AI_PROVIDER: z.enum(["openai", "anthropic", "none"]).default("none"),
  AI_API_KEY: z.string().default(""),
  AI_MODEL_FAST: z.string().default("gpt-4o-mini"),
  AI_MODEL_STRONG: z.string().default("gpt-4o"),
  AI_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  META_APP_ID: z.string().default(""),
  META_APP_SECRET: z.string().default(""),
  GOOGLE_ADS_CLIENT_ID: z.string().default(""),
  GOOGLE_ADS_CLIENT_SECRET: z.string().default(""),
  GOOGLE_ADS_DEVELOPER_TOKEN: z.string().default(""),
  SENTRY_DSN: z.string().default(""),
  LOG_LEVEL: z
    .enum(["trace", "debug", "info", "warn", "error", "fatal"])
    .default("info"),
  /** Comma-separated shop domains allowed to access /admin routes. */
  PLATFORM_ADMIN_SHOPS: z.string().default(""),
  /** Shared secret for /admin/* and /health/deep endpoints when not embedded. */
  PLATFORM_ADMIN_TOKEN: z.string().default(""),
  /** Shopify App Pricing: Partner API access for `activeSubscription` checks. */
  SHOPIFY_PARTNER_ORG_ID: z.string().default(""),
  SHOPIFY_PARTNER_API_ACCESS_TOKEN: z.string().default(""),
  SHOPIFY_APP_GID: z.string().default(""),
  SHOPIFY_APP_HANDLE: z.string().default("profitpilot-ai"),
  BILLING_TEST_MODE: z
    .string()
    .default("true")
    .transform((v) => v === "true"),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(240),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function env(): Env {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      throw new Error(
        `Invalid environment fields: ${[...new Set(parsed.error.issues.map((issue) => issue.path.join(".")))].join(", ")}`,
      );
    }
    assertProductionEnv(parsed.data);
    cached = parsed.data;
  }
  return cached;
}

export function isProduction(): boolean {
  return env().NODE_ENV === "production";
}

/** Validates the variables that must be present in production; call at boot. */
export function assertProductionEnv(e: Env): void {
  if (e.NODE_ENV !== "production") return;
  const missing: string[] = [];
  for (const key of [
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
  ] as const) {
    if (!e[key].trim()) missing.push(key);
  }
  if (missing.length) {
    throw new Error(
      `Missing required production environment variables: ${missing.join(", ")}`,
    );
  }
  const invalid: string[] = [];
  const urlMatches = (value: string, protocols: string[]) => {
    try {
      const url = new URL(value);
      return protocols.includes(url.protocol) && Boolean(url.hostname);
    } catch {
      return false;
    }
  };
  if (!urlMatches(e.DATABASE_URL, ["postgres:", "postgresql:"]))
    invalid.push("DATABASE_URL");
  if (!urlMatches(e.REDIS_URL, ["redis:", "rediss:"]))
    invalid.push("REDIS_URL");
  if (!urlMatches(e.SHOPIFY_APP_URL, ["https:"]))
    invalid.push("SHOPIFY_APP_URL");
  else {
    const url = new URL(e.SHOPIFY_APP_URL);
    if (
      url.username ||
      url.password ||
      ["localhost", "127.0.0.1", "0.0.0.0", "[::1]", "example.com"].includes(
        url.hostname,
      ) ||
      url.hostname.endsWith(".example.com")
    )
      invalid.push("SHOPIFY_APP_URL");
  }
  const raw = e.ENCRYPTION_KEY;
  const isHex = /^[a-fA-F0-9]{64}$/.test(raw);
  const isBase64 = /^[A-Za-z0-9+/]{43}=?$/.test(raw);
  const key = isHex
    ? Buffer.from(raw, "hex")
    : isBase64
      ? Buffer.from(raw, "base64")
      : null;
  if (!key || key.length !== 32 || key.every((byte) => byte === 0))
    invalid.push("ENCRYPTION_KEY");
  if (e.AI_PROVIDER !== "none" && !e.AI_API_KEY.trim())
    invalid.push("AI_API_KEY");
  if (!/^[1-9]\d*$/.test(e.SHOPIFY_PARTNER_ORG_ID))
    invalid.push("SHOPIFY_PARTNER_ORG_ID");
  if (!/^gid:\/\/shopify\/App\/[1-9]\d*$/.test(e.SHOPIFY_APP_GID))
    invalid.push("SHOPIFY_APP_GID");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(e.SHOPIFY_APP_HANDLE))
    invalid.push("SHOPIFY_APP_HANDLE");
  if (invalid.length)
    throw new Error(
      `Invalid production environment fields: ${invalid.join(", ")}`,
    );
}
