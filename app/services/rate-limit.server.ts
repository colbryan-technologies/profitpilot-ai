import { createHash } from "node:crypto";
import IORedis from "ioredis";
import { env } from "../lib/env.server";
import { logger } from "../lib/logger.server";
import { failureCategory } from "../lib/failure-category";
export type RateScope = "requests" | "mutations" | "sync" | "briefing";
let connection: IORedis | null = null;
function client() {
  if (!connection || connection.status === "end") {
    connection = new IORedis(env().REDIS_URL, {
      maxRetriesPerRequest: 1,
      connectTimeout: 1500,
      commandTimeout: 2000,
      retryStrategy: () => null,
    });
    connection.on("error", () => logger.warn("request limiter unavailable"));
  }
  return connection;
}
export function rateKey(storeId: string, scope: RateScope) {
  return `profitpilot:limits:v1:${scope}:${createHash("sha256").update(storeId).digest("hex")}`;
}
// One Redis operation both consumes a slot and establishes expiry. Rejections
// do not extend the window or grow the counter without bound.
const SCRIPT = `
local count = tonumber(redis.call('GET', KEYS[1]) or '0')
local ttl = redis.call('PTTL', KEYS[1])
if count >= tonumber(ARGV[1]) then
  if ttl < 0 then redis.call('PEXPIRE', KEYS[1], ARGV[2]); ttl = tonumber(ARGV[2]) end
  return {0, ttl}
end
count = redis.call('INCR', KEYS[1])
if count == 1 or ttl < 0 then redis.call('PEXPIRE', KEYS[1], ARGV[2]); ttl = tonumber(ARGV[2]) end
return {1, ttl}
`;
export async function consumeRateLimit(
  storeId: string,
  scope: RateScope,
  limit: number,
  windowMs: number,
  redis: Pick<IORedis, "eval"> = client(),
) {
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    !Number.isSafeInteger(windowMs) ||
    windowMs < 1
  )
    throw new Error("Invalid rate limit policy");
  let result: unknown;
  const started = Date.now();
  try {
    result = await redis.eval(
      SCRIPT,
      1,
      rateKey(storeId, scope),
      limit,
      windowMs,
    );
  } catch (error) {
    logger.error(
      {
        stage: "redis_rate_limit",
        category: failureCategory(error),
        elapsedMs: Date.now() - started,
      },
      "profitpilot_diagnostic",
    );
    throw new Response(
      "Request protection is temporarily unavailable. Please try again shortly.",
      {
        status: 503,
        headers: { "Retry-After": "30", "Cache-Control": "no-store" },
      },
    );
  }
  if (
    !Array.isArray(result) ||
    result.length !== 2 ||
    ![0, 1].includes(result[0]) ||
    !Number.isFinite(result[1])
  ) {
    logger.error(
      {
        stage: "redis_rate_limit",
        category: "invalid_response",
        elapsedMs: Date.now() - started,
      },
      "profitpilot_diagnostic",
    );
    throw new Response("Request protection is temporarily unavailable.", {
      status: 503,
      headers: { "Retry-After": "30", "Cache-Control": "no-store" },
    });
  }
  if (result[0] === 0) {
    const seconds = Math.max(1, Math.ceil(result[1] / 1000));
    throw new Response(
      `Too many requests. Please try again in ${seconds} seconds.`,
      {
        status: 429,
        headers: {
          "Retry-After": String(seconds),
          "Cache-Control": "no-store",
        },
      },
    );
  }
}
