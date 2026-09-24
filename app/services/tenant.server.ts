import { consumeRateLimit } from "./rate-limit.server";
import { env } from "../lib/env.server";
import { authenticate } from "../shopify.server";
import { requireStore } from "./store.server";
import { isPeriodKey, resolvePeriod } from "../lib/dates";

/** Always resolve tenancy from the verified session, never a form or URL ID. */
export async function tenant(request: Request) {
  const auth = await authenticate.admin(request);
  const store = await requireStore(auth.session.shop);
  if (store.status !== "ACTIVE")
    throw new Response("This installation is inactive", { status: 403 });
  await consumeRateLimit(
    store.id,
    "requests",
    env().RATE_LIMIT_PER_MINUTE,
    60_000,
  );
  if (!["GET", "HEAD"].includes(request.method))
    await consumeRateLimit(
      store.id,
      "mutations",
      Math.min(60, env().RATE_LIMIT_PER_MINUTE),
      60_000,
    );
  return {
    ...auth,
    store,
    actorId:
      auth.session.onlineAccessInfo?.associated_user.id.toString() ?? null,
  };
}

export function requestPeriod(request: Request, timeZone: string) {
  const value = new URL(request.url).searchParams.get("period");
  return resolvePeriod(
    isPeriodKey(value) && value !== "custom" ? value : "30d",
    timeZone,
  );
}

export function pageNumber(request: Request) {
  const p = Number(new URL(request.url).searchParams.get("page") ?? 1);
  return Number.isSafeInteger(p) && p > 0 && p <= 100_000 ? p : 1;
}
