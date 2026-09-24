# Shared request and briefing limits

Authenticated tenant requests now use atomic Redis counters shared across web processes. The existing RATE_LIMIT_PER_MINUTE setting is enforced (default 240 per minute). Mutations additionally allow at most 60 per minute, or the configured request limit if lower. Manual import, resync and recalculation attempts share three slots per five minutes. Weekly briefing generation allows one attempt per store per five minutes across workers and web processes; fresh cached briefings do not consume this slot. Failed generation attempts consume a slot.

Keys contain a hash of the authenticated internal store identifier, not a merchant domain or caller-supplied identity. Counters expire automatically. Lua makes consumption and expiry atomic; rejected requests neither increase counters nor prolong their window. Missing expiration is repaired. Responses include HTTP 429 and Retry-After. Redis failures reject work with HTTP 503, bounded connection/command waits and generic messages. Form responses preserve retry guidance without exposing infrastructure errors.

These are fixed windows starting with the first accepted request. Boundary bursts remain possible. The briefing limit is not a distributed lock: work exceeding five minutes can overlap a later attempt. Authentication callbacks and Shopify webhooks retain their own existing validation and are outside the authenticated tenant limiter. Edge protection for unauthenticated traffic remains deployment work. A Redis outage temporarily prevents authenticated app access; there is no process-local bypass.

Validation: local lint, typecheck and production builds pass; 147 unit tests pass. CI now provisions isolated Redis alongside PostgreSQL for 31 integration tests, including concurrent independent clients, expiry, missing-expiry repair and briefing limits. No production deployment or Shopify submission performed.

References: [Redis atomic counter pattern](https://redis.io/docs/latest/commands/incr/) and [ioredis connection options](https://redis.github.io/ioredis/interfaces/CommonRedisOptions.html).
