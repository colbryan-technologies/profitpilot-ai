import { createHash } from "node:crypto";
import IORedis from "ioredis";
import { env } from "../lib/env.server";
import { logger } from "../lib/logger.server";
import { failureCategory } from "../lib/failure-category";
export type RateScope = "requests" | "mutations" | "sync" | "briefing";
type ConnectionState = {
  redis: IORedis | null;
  pending: boolean;
  ready: Promise<IORedis> | null;
};
let connection: ConnectionState | null = null;
function discardConnection(redis: IORedis) {
  if (connection?.redis === redis) {
    connection = null;
  }
  redis.disconnect();
}
async function connectReady(state: ConnectionState): Promise<IORedis> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const redis = new IORedis(env().REDIS_URL, {
      lazyConnect: true,
      connectTimeout: 5000,
      // This also governs the client's internal AUTH/INFO handshake commands.
      commandTimeout: 5000,
      // Admission must not run later from an offline queue or be replayed
      // after an ambiguous connection failure.
      enableOfflineQueue: false,
      autoResendUnfulfilledCommands: false,
      maxRetriesPerRequest: 0,
      retryStrategy: () => null,
    });
    state.redis = redis;
    let connectionError: unknown;
    redis.on("error", (error) => {
      connectionError = error;
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        redis.connect(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Redis readiness timeout")),
            5000,
          );
        }),
      ]);
      return redis;
    } catch (error) {
      // Preserve the handshake error rather than the generic "connection
      // closed" rejection, especially so authentication errors are not retried.
      const cause = connectionError ?? error;
      const category = failureCategory(cause);
      redis.disconnect();
      logger.warn(
        { stage: "redis_connection_attempt", attempt, category },
        "profitpilot_diagnostic",
      );
      if (
        attempt === 2 ||
        !["connection_unavailable", "timeout"].includes(category)
      )
        throw cause;
    } finally {
      clearTimeout(timer);
    }
    // No EVAL has been sent. One fresh connection attempt is safe; never
    // retry an admission command whose execution could be ambiguous.
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Redis readiness attempts exhausted");
}
function client(): Promise<IORedis> {
  // Keep sharing readiness during the retry delay, even if the first socket
  // is already closed. Concurrent loaders must not start separate retries.
  if (
    connection &&
    (connection.pending || connection.redis?.status === "ready")
  )
    return connection.ready!;
  if (connection?.redis) discardConnection(connection.redis);
  const state: ConnectionState = { redis: null, pending: true, ready: null };
  connection = state;
  state.ready = connectReady(state).then(
    (redis) => {
      state.pending = false;
      return redis;
    },
    (error) => {
      state.pending = false;
      if (connection === state) connection = null;
      throw error;
    },
  );
  return state.ready;
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
  redis?: Pick<IORedis, "eval">,
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
  let managed: IORedis | undefined;
  let phase = redis ? "command" : "connection";
  try {
    const ready = redis ?? (managed = await client());
    phase = "command";
    result = await ready.eval(
      SCRIPT,
      1,
      rateKey(storeId, scope),
      limit,
      windowMs,
    );
  } catch (error) {
    if (managed) discardConnection(managed);
    logger.error(
      {
        stage: "redis_rate_limit",
        phase,
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
