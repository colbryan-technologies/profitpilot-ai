import prisma from "../../db.server";
import { logger } from "../../lib/logger.server";
import { enqueueWebhook, enqueueSync, scheduleDebouncedRecalc } from "../jobs/queue.server";
import { gid } from "./mappers";
import { deleteOrder, softDeleteProduct } from "./persist.server";
import { syncSingleOrder, syncSingleProduct } from "./sync.server";
import { audit, getStoreByDomain, markUninstalled, redactCustomer, redactStore } from "../store.server";

/**
 * Persist a verified webhook and hand it to the queue. Returns false if the
 * webhook ID was already seen (Shopify retries deliveries).
 *
 * The HTTP handler only does this — actual processing happens in the worker so
 * we can respond to Shopify within its 5s window regardless of load.
 */
export async function recordWebhook(params: { webhookId: string; topic: string; shopDomain: string; apiVersion?: string | null; triggeredAt?: string | null; payload: unknown }): Promise<boolean> {
  const store = await getStoreByDomain(params.shopDomain);
  try {
    const event = await prisma.webhookEvent.create({
      data: {
        webhookId: params.webhookId,
        topic: params.topic,
        shopDomain: params.shopDomain.toLowerCase(),
        storeId: store?.id ?? null,
        apiVersion: params.apiVersion ?? null,
        triggeredAt: params.triggeredAt ? new Date(params.triggeredAt) : null,
        payload: JSON.parse(JSON.stringify(params.payload ?? {})),
      },
      select: { id: true },
    });
    await enqueueWebhook(event.id);
    return true;
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") {
      logger.info({ webhookId: params.webhookId, topic: params.topic }, "duplicate webhook ignored");
      return false;
    }
    throw err;
  }
}

type Payload = Record<string, unknown>;

/** Worker-side webhook processing. Idempotent: safe to re-run for the same event. */
export async function processWebhookEvent(webhookEventId: string): Promise<void> {
  const event = await prisma.webhookEvent.findUnique({ where: { id: webhookEventId } });
  if (!event || event.status === "PROCESSED" || event.status === "IGNORED") return;
  const log = logger.child({ webhookEventId, topic: event.topic, shopDomain: event.shopDomain });
  await prisma.webhookEvent.update({ where: { id: event.id }, data: { attempts: { increment: 1 } } });

  try {
    const outcome = await dispatch(event.topic, event.shopDomain, event.storeId, event.payload as Payload);
    await prisma.webhookEvent.update({ where: { id: event.id }, data: { status: outcome, processedAt: new Date(), lastError: null } });
  } catch (err) {
    const message = (err as Error).message;
    const attempts = event.attempts + 1;
    const dead = attempts >= 8;
    await prisma.webhookEvent.update({ where: { id: event.id }, data: { status: dead ? "DEAD_LETTER" : "FAILED", lastError: message.slice(0, 2000) } });
    log.error({ err: message, attempts, dead }, "webhook processing failed");
    throw err;
  }
}

async function dispatch(topic: string, shopDomain: string, storeId: string | null, payload: Payload): Promise<"PROCESSED" | "IGNORED"> {
  switch (topic) {
    case "APP_UNINSTALLED": {
      await markUninstalled(shopDomain);
      await audit({ storeId, actorType: "webhook", action: "app.uninstalled", metadata: { shopDomain } });
      return "PROCESSED";
    }
    case "SHOP_REDACT": {
      const deleted = await redactStore(shopDomain);
      await audit({ storeId: null, actorType: "webhook", action: "gdpr.shop_redact", metadata: { shopDomain, deleted } });
      return "PROCESSED";
    }
    case "CUSTOMERS_REDACT": {
      if (!storeId) return "IGNORED";
      const customer = payload.customer as { id?: number | string } | undefined;
      const orders = (payload.orders_to_redact as Array<number | string> | undefined) ?? [];
      const count = await redactCustomer(storeId, customer?.id ? [gid("Customer", customer.id)] : [], orders.map((o) => gid("Order", o)));
      await audit({ storeId, actorType: "webhook", action: "gdpr.customers_redact", metadata: { ordersUpdated: count } });
      return "PROCESSED";
    }
    case "CUSTOMERS_DATA_REQUEST": {
      // We store no personal customer data beyond Shopify IDs; log for the merchant's records.
      await audit({ storeId, actorType: "webhook", action: "gdpr.customers_data_request", metadata: { dataRequestId: (payload.data_request as { id?: number } | undefined)?.id ?? null } });
      return "PROCESSED";
    }
  }

  if (!storeId) return "IGNORED";
  const store = await prisma.store.findUnique({ where: { id: storeId }, select: { status: true } });
  if (!store || store.status !== "ACTIVE") return "IGNORED";

  switch (topic) {
    case "ORDERS_CREATE":
    case "ORDERS_UPDATED":
    case "ORDERS_PAID":
    case "ORDERS_CANCELLED":
    case "ORDERS_EDITED":
    case "REFUNDS_CREATE": {
      const rawId = topic === "REFUNDS_CREATE" || topic === "ORDERS_EDITED" ? (payload.order_id as number | string | undefined) ?? (payload.order_edit as { order_id?: number } | undefined)?.order_id : (payload.id as number | string | undefined);
      if (!rawId) return "IGNORED";
      // Always re-fetch from the Admin API rather than trusting the payload: the
      // GraphQL shape (fees, refund lines) is richer and the same for all paths.
      const changed = await syncSingleOrder(storeId, shopDomain, gid("Order", rawId));
      if (changed) {
        const processedAt = payload.processed_at ? new Date(String(payload.processed_at)) : null;
        await scheduleDebouncedRecalc(storeId, processedAt);
      }
      return "PROCESSED";
    }
    case "ORDERS_DELETE": {
      const id = payload.id as number | string | undefined;
      if (id) await deleteOrder(storeId, gid("Order", id));
      await scheduleDebouncedRecalc(storeId, null);
      return "PROCESSED";
    }
    case "PRODUCTS_CREATE":
    case "PRODUCTS_UPDATE": {
      const id = payload.id as number | string | undefined;
      if (id) await syncSingleProduct(storeId, shopDomain, gid("Product", id));
      return "PROCESSED";
    }
    case "PRODUCTS_DELETE": {
      const id = payload.id as number | string | undefined;
      if (id) await softDeleteProduct(storeId, gid("Product", id));
      return "PROCESSED";
    }
    case "APP_SCOPES_UPDATE": {
      const current = (payload.current as string[] | undefined) ?? [];
      await prisma.installation.updateMany({ where: { storeId, uninstalledAt: null }, data: { grantedScopes: current.join(",") } });
      return "PROCESSED";
    }
    case "SHOP_UPDATE": {
      await enqueueSync(storeId, shopDomain, "SHOP_INFO");
      return "PROCESSED";
    }
    case "APP_SUBSCRIPTIONS_UPDATE": {
      const sub = payload.app_subscription as { admin_graphql_api_id?: string; name?: string; status?: string; updated_at?: string } | undefined;
      if (sub) {
        await prisma.subscription.updateMany({
          where: { storeId },
          data: { shopifySubscriptionId: sub.admin_graphql_api_id ?? null, planKey: (sub.name ?? "free").toLowerCase().replace(/\s+/g, "_"), status: mapSubscriptionStatus(sub.status), ...(sub.status === "CANCELLED" ? { cancelledAt: new Date() } : {}) },
        });
      }
      return "PROCESSED";
    }
    default:
      logger.warn({ topic }, "unhandled webhook topic");
      return "IGNORED";
  }
}

function mapSubscriptionStatus(status: string | undefined): "ACTIVE" | "PENDING" | "CANCELLED" | "FROZEN" | "EXPIRED" {
  switch (status) {
    case "ACTIVE":
      return "ACTIVE";
    case "CANCELLED":
      return "CANCELLED";
    case "FROZEN":
      return "FROZEN";
    case "EXPIRED":
      return "EXPIRED";
    case "DECLINED":
      return "EXPIRED";
    default:
      return "PENDING";
  }
}
