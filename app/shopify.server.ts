import "@shopify/shopify-app-react-router/adapters/node";
import { ApiVersion, AppDistribution, shopifyApp } from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import { env } from "./lib/env.server";
import { logger } from "./lib/logger.server";
import { ensureStore, audit } from "./services/store.server";
import { startInitialSync } from "./services/jobs/sync-runner.server";

const config = env();

const shopify = shopifyApp({
  apiKey: config.SHOPIFY_API_KEY,
  apiSecretKey: config.SHOPIFY_API_SECRET,
  apiVersion: ApiVersion.October25,
  scopes: config.SCOPES.split(","),
  appUrl: config.SHOPIFY_APP_URL,
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  future: {
    expiringOfflineAccessTokens: true,
  },
  hooks: {
    afterAuth: async ({ session }) => {
      const store = await ensureStore(session.shop, { scopes: session.scope ?? "", apiVersion: ApiVersion.October25 });
      const hasHistory = await prisma.syncJob.findFirst({ where: { storeId: store.id, type: "HISTORICAL_ORDERS" }, select: { id: true } });
      if (!hasHistory) {
        try {
          await startInitialSync(store.id, session.shop);
        } catch (err) {
          // Redis unavailable at install time must not break OAuth; onboarding lets the merchant retry.
          logger.error({ shopDomain: session.shop, err: (err as Error).message }, "failed to queue initial sync");
        }
      }
      await audit({ storeId: store.id, actorType: "system", action: "auth.completed", metadata: { scopes: session.scope ?? "" } });
    },
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] } : {}),
});

export default shopify;
export const apiVersion = ApiVersion.October25;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
