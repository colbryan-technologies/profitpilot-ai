import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { recordWebhook } from "../services/shopify/webhooks.server";
import { logger } from "../lib/logger.server";

/**
 * Single ingress for every Shopify webhook topic (including the mandatory
 * compliance topics). `authenticate.webhook` verifies the HMAC signature and
 * rejects anything unsigned with 401. We persist the event and enqueue it;
 * the worker does the real work so we always respond well within 5 seconds.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, webhookId, apiVersion, payload } = await authenticate.webhook(request);
  const triggeredAt = request.headers.get("X-Shopify-Triggered-At");
  const stored = await recordWebhook({ webhookId, topic, shopDomain: shop, apiVersion, triggeredAt, payload });
  logger.info({ topic, shop, webhookId, duplicate: !stored }, "webhook received");
  return new Response(null, { status: 200 });
};

export const loader = () => new Response("Method Not Allowed", { status: 405 });
