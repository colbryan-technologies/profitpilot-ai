import { z } from "zod";
import prisma from "../db.server";
import { env } from "../lib/env.server";
import { logger } from "../lib/logger.server";
import { lockStore } from "./erasure.server";
import { audit } from "./store.server";

/**
 * Billing uses Shopify App Pricing: plans, prices and trials are configured in
 * the Partner Dashboard and Shopify hosts the plan-selection page. The app never
 * creates charges. It only (a) reads the merchant's active contract through the
 * Partner API `activeSubscription` query, (b) mirrors it locally for fast
 * entitlement checks, and (c) redirects merchants without a plan to the hosted
 * plan page. Plan handles here MUST match the handles configured in the
 * Partner Dashboard.
 */

export type PlanKey = "free" | "starter" | "growth" | "pro" | "scale";

export interface PlanDefinition {
  key: PlanKey;
  name: string;
  /** Monthly orders included (soft limit used for messaging, enforced on sync depth). */
  orderLimit: number | null;
  historyDays: number;
  askPerDay: number;
  adAccounts: number;
  digest: boolean;
  csvExport: boolean;
}

export const PLANS: Record<PlanKey, PlanDefinition> = {
  free: {
    key: "free",
    name: "Free",
    orderLimit: 100,
    historyDays: 30,
    askPerDay: 10,
    adAccounts: 0,
    digest: false,
    csvExport: false,
  },
  starter: {
    key: "starter",
    name: "Starter",
    orderLimit: 500,
    historyDays: 90,
    askPerDay: 50,
    adAccounts: 1,
    digest: true,
    csvExport: true,
  },
  growth: {
    key: "growth",
    name: "Growth",
    orderLimit: 2_500,
    historyDays: 365,
    askPerDay: 200,
    adAccounts: 3,
    digest: true,
    csvExport: true,
  },
  pro: {
    key: "pro",
    name: "Pro",
    orderLimit: 10_000,
    historyDays: 730,
    askPerDay: 1_000,
    adAccounts: 10,
    digest: true,
    csvExport: true,
  },
  scale: {
    key: "scale",
    name: "Scale",
    orderLimit: null,
    historyDays: 1_095,
    askPerDay: 5_000,
    adAccounts: 50,
    digest: true,
    csvExport: true,
  },
};

const planKeySchema = z.enum(["free", "starter", "growth", "pro", "scale"]);

export function planFor(key: string | null | undefined): PlanDefinition {
  const parsed = planKeySchema.safeParse(key);
  return PLANS[parsed.success ? parsed.data : "free"];
}

const activeSubscriptionSchema = z.object({
  data: z
    .object({
      activeSubscription: z
        .object({
          billingPeriod: z.string().nullable().optional(),
          cancelAtEndOfCycle: z.boolean().nullable().optional(),
          trialEndsAt: z.string().nullable().optional(),
          currentBillingCycle: z
            .object({ startTime: z.string(), endTime: z.string() })
            .nullable()
            .optional(),
          items: z.array(z.object({ handle: z.string() })).default([]),
          legacySubscriptionId: z.string().nullable().optional(),
        })
        .nullable(),
    })
    .optional(),
  errors: z.array(z.unknown()).optional(),
});

export type ActiveSubscription = NonNullable<
  NonNullable<
    z.infer<typeof activeSubscriptionSchema>["data"]
  >["activeSubscription"]
>;

/** True when Partner API credentials are configured; otherwise billing is in "not enforced" mode. */
export function billingConfigured(): boolean {
  const e = env();
  return Boolean(
    e.SHOPIFY_PARTNER_ORG_ID &&
    e.SHOPIFY_PARTNER_API_ACCESS_TOKEN &&
    e.SHOPIFY_APP_GID,
  );
}

/**
 * Partner API `activeSubscription(appId, shopId)`. Throws on failures/throttles
 * so callers never treat a transient error as "no subscription".
 */
export async function fetchActiveSubscription(
  shopGid: string,
): Promise<ActiveSubscription | null> {
  const e = env();
  const res = await fetch(
    `https://partners.shopify.com/${e.SHOPIFY_PARTNER_ORG_ID}/api/unstable/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": e.SHOPIFY_PARTNER_API_ACCESS_TOKEN,
      },
      body: JSON.stringify({
        query: `query ($appId: ID!, $shopId: ID!) {
        activeSubscription(appId: $appId, shopId: $shopId) {
          billingPeriod
          cancelAtEndOfCycle
          trialEndsAt
          currentBillingCycle { startTime endTime }
          items { handle }
          legacySubscriptionId
        }
      }`,
        variables: { appId: e.SHOPIFY_APP_GID, shopId: shopGid },
      }),
      signal: AbortSignal.timeout(10_000),
    },
  );
  const json = activeSubscriptionSchema.parse(
    await res.json().catch(() => ({})),
  );
  if (!res.ok || json.errors?.length) {
    throw new Error(`Partner API request failed: ${res.status}`);
  }
  if (!json.data)
    throw new Error("Partner API response is missing subscription data");
  return json.data.activeSubscription;
}

/** Hosted plan-selection page URL (outside the app iframe; redirect with target "_top"). */
export function planSelectionUrl(
  shopDomain: string,
  appHandle: string,
): string {
  const storeHandle = shopDomain.replace(".myshopify.com", "");
  return `https://admin.shopify.com/store/${storeHandle}/charges/${appHandle}/pricing_plans`;
}

const CACHE_MS = 5 * 60_000;

/**
 * Returns the merchant's effective plan. Uses the local mirror when it was
 * confirmed within the cache window; otherwise refreshes from the Partner API.
 * If Partner API credentials are not configured (development / before App
 * Pricing is enabled) the local plan (default "free") is used without enforcement.
 */
export async function resolveEntitlements(
  storeId: string,
  shopGid: string | null,
  opts: { force?: boolean } = {},
): Promise<{
  plan: PlanDefinition;
  active: boolean;
  source: "cache" | "partner" | "unenforced";
  trialEndsAt: Date | null;
}> {
  const sub = await prisma.subscription.findUnique({ where: { storeId } });
  if (!billingConfigured()) {
    return {
      plan: planFor(sub?.planKey),
      active: true,
      source: "unenforced",
      trialEndsAt: sub?.trialEndsAt ?? null,
    };
  }
  if (!shopGid)
    throw new Error("Cannot verify billing without a Shopify shop ID");
  const age = sub ? Date.now() - sub.updatedAt.getTime() : Infinity;
  const fresh =
    sub &&
    sub.status === "ACTIVE" &&
    age >= 0 &&
    age < CACHE_MS &&
    (!sub.currentPeriodEnd || sub.currentPeriodEnd.getTime() > Date.now());
  if (fresh && !opts.force) {
    return {
      plan: planFor(sub.planKey),
      active: true,
      source: "cache",
      trialEndsAt: sub.trialEndsAt,
    };
  }
  const remote = await fetchActiveSubscription(shopGid);
  if (!remote) {
    if (sub && sub.status === "ACTIVE") {
      await prisma.subscription.update({
        where: { storeId },
        data: { status: "CANCELLED", cancelledAt: new Date() },
      });
      await audit({
        storeId,
        actorType: "system",
        action: "billing.subscription_ended",
        metadata: { previousPlan: sub.planKey },
      });
    }
    return {
      plan: PLANS.free,
      active: false,
      source: "partner",
      trialEndsAt: null,
    };
  }
  const handles = [...new Set(remote.items.map((item) => item.handle))];
  if (handles.length !== 1 || !planKeySchema.safeParse(handles[0]).success)
    throw new Error(
      "Subscription plan is not recognized; verify pricing configuration",
    );
  const planKey = planKeySchema.parse(handles[0]);
  await prisma.subscription.upsert({
    where: { storeId },
    create: {
      storeId,
      planKey,
      status: "ACTIVE",
      shopifySubscriptionId: remote.legacySubscriptionId ?? null,
      currentPeriodEnd: remote.currentBillingCycle
        ? new Date(remote.currentBillingCycle.endTime)
        : null,
      trialEndsAt: remote.trialEndsAt ? new Date(remote.trialEndsAt) : null,
      isTest: env().BILLING_TEST_MODE,
    },
    update: {
      planKey,
      status: "ACTIVE",
      shopifySubscriptionId: remote.legacySubscriptionId ?? null,
      currentPeriodEnd: remote.currentBillingCycle
        ? new Date(remote.currentBillingCycle.endTime)
        : null,
      trialEndsAt: remote.trialEndsAt ? new Date(remote.trialEndsAt) : null,
      cancelledAt: null,
      updatedAt: new Date(),
    },
  });
  if (sub?.planKey !== planKey) {
    logger.info({ storeId, planKey }, "billing: plan changed");
    await audit({
      storeId,
      actorType: "system",
      action: "billing.plan_changed",
      metadata: { from: sub?.planKey ?? null, to: planKey },
    });
  }
  return {
    plan: PLANS[planKey],
    active: true,
    source: "partner",
    trialEndsAt: remote.trialEndsAt ? new Date(remote.trialEndsAt) : null,
  };
}

/** Called from APP_SUBSCRIPTIONS_UPDATE webhook; forces a refresh on next request. */
export async function invalidateSubscription(storeId: string): Promise<void> {
  await prisma.subscription.updateMany({
    where: { storeId },
    data: { updatedAt: new Date(0) },
  });
}

/** Resolve from the tenant record, never a caller-supplied shop identity. */
export async function storeEntitlements(storeId: string) {
  const store = await prisma.store.findUniqueOrThrow({
    where: { id: storeId },
    select: { shopifyShopId: true },
  });
  return resolveEntitlements(
    storeId,
    store.shopifyShopId ? `gid://shopify/Shop/${store.shopifyShopId}` : null,
  );
}

/** Reserve before work so concurrent requests cannot spend the same allowance.
 * Attempts count in a rolling 24-hour window, including fallback or interrupted work.
 * No external calls take place while holding the tenant lock.
 */
export async function reserveAskUsage(storeId: string) {
  const { plan } = await storeEntitlements(storeId);
  return prisma.$transaction(async (tx) => {
    if (!(await lockStore(tx, storeId)))
      throw new Error("Store no longer exists");
    const count = await tx.aiUsage.count({
      where: {
        storeId,
        feature: "ask",
        createdAt: { gte: new Date(Date.now() - 86_400_000) },
      },
    });
    if (count >= plan.askPerDay)
      throw new Response(
        `Daily Ask ProfitPilot limit reached (${plan.askPerDay}). Upgrade your plan for more.`,
        { status: 429 },
      );
    return tx.aiUsage.create({
      data: {
        storeId,
        feature: "ask",
        provider: "none",
        model: "reserved",
        inputTokens: 0,
        outputTokens: 0,
        costMicros: 0,
        latencyMs: 0,
        success: false,
      },
    });
  });
}
