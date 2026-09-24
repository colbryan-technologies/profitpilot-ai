import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  SHOPIFY_API_KEY: z.string().default(""),
  SHOPIFY_API_SECRET: z.string().default(""),
  SHOPIFY_APP_URL: z.string().default("http://localhost:3000"),
  SCOPES: z.string().default("read_orders,read_all_orders,read_products,read_inventory"),
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
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
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
      throw new Error(`Invalid environment: ${parsed.error.message}`);
    }
    cached = parsed.data;
  }
  return cached;
}

export function isProduction(): boolean {
  return env().NODE_ENV === "production";
}

/** Validates the variables that must be present in production; call at boot. */
export function assertProductionEnv(): void {
  if (!isProduction()) return;
  const e = env();
  const missing: string[] = [];
  for (const key of ["SHOPIFY_API_KEY", "SHOPIFY_API_SECRET", "SHOPIFY_APP_URL", "DATABASE_URL", "REDIS_URL", "ENCRYPTION_KEY"] as const) {
    if (!e[key]) missing.push(key);
  }
  if (missing.length) {
    throw new Error(`Missing required production environment variables: ${missing.join(", ")}`);
  }
}
