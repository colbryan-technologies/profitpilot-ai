import { randomUUID } from "node:crypto";
import IORedis from "ioredis";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import {
  consumeRateLimit,
  rateKey,
} from "../../app/services/rate-limit.server";
const tenant = `rate-test-${randomUUID()}`;
let a: IORedis, b: IORedis;
describe.skipIf(process.env.RUN_REDIS_TESTS !== "1")(
  "shared Redis request limits",
  () => {
    beforeAll(async () => {
      const url = new URL(process.env.REDIS_URL ?? "");
      if (
        !["localhost", "127.0.0.1"].includes(url.hostname) ||
        url.pathname !== "/15"
      )
        throw new Error("Requires isolated local Redis database 15");
      a = new IORedis(url.href);
      b = new IORedis(url.href);
      await Promise.all([a.ping(), b.ping()]);
    });
    afterAll(async () => {
      if (a) {
        await a.del(
          ...["requests", "sync", "briefing", "mutations"].map((s) =>
            rateKey(tenant, s as "requests"),
          ),
        );
        await a.quit();
      }
      if (b) await b.quit();
    });
    it("admits exactly the configured count across separate connections", async () => {
      const results = await Promise.allSettled(
        Array.from({ length: 20 }, (_, i) =>
          consumeRateLimit(tenant, "requests", 5, 60000, i % 2 ? a : b),
        ),
      );
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(5);
      for (const r of results)
        if (r.status === "rejected") expect(r.reason.status).toBe(429);
      expect(await a.get(rateKey(tenant, "requests"))).toBe("5");
      expect(await a.pttl(rateKey(tenant, "requests"))).toBeGreaterThan(0);
    });
    it("allows only one briefing generation attempt per window", async () => {
      const results = await Promise.allSettled(
        [a, b].map((c) => consumeRateLimit(tenant, "briefing", 1, 300000, c)),
      );
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    });
    it("opens a new window after expiry", async () => {
      await consumeRateLimit(tenant, "sync", 1, 60000, a);
      await a.pexpire(rateKey(tenant, "sync"), 1);
      await new Promise((r) => setTimeout(r, 20));
      await expect(
        consumeRateLimit(tenant, "sync", 1, 60000, b),
      ).resolves.toBeUndefined();
    });
    it("repairs a counter missing its expiration", async () => {
      await a.set(rateKey(tenant, "mutations"), "5");
      await expect(
        consumeRateLimit(tenant, "mutations", 5, 60000, b),
      ).rejects.toMatchObject({ status: 429 });
      expect(await a.pttl(rateKey(tenant, "mutations"))).toBeGreaterThan(0);
    });
  },
);
