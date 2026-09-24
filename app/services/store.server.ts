import type { Store } from "@prisma/client";
import prisma from "../db.server";
import { logger } from "../lib/logger.server";

/**
 * Tenant boundary. Every data access in the app goes through a `storeId`
 * obtained from the authenticated Shopify session's shop domain — never from
 * user input.
 */
export async function getStoreByDomain(shopDomain: string): Promise<Store | null> {
  return prisma.store.findUnique({ where: { shopDomain: shopDomain.toLowerCase() } });
}

export async function requireStore(shopDomain: string): Promise<Store> {
  const store = await getStoreByDomain(shopDomain);
  if (!store) throw new Response("Store not found", { status: 404 });
  return store;
}

/** Idempotently ensure a Store (and owning Organization) exists for a shop domain. */
export async function ensureStore(shopDomain: string, opts: { scopes: string; apiVersion: string }): Promise<Store> {
  const domain = shopDomain.toLowerCase();
  const existing = await prisma.store.findUnique({ where: { shopDomain: domain } });
  if (existing) {
    if (existing.status !== "ACTIVE") {
      logger.info({ shopDomain: domain }, "store reinstalled");
      const store = await prisma.store.update({
        where: { id: existing.id },
        data: { status: "ACTIVE", uninstalledAt: null, installedAt: new Date() },
      });
      await prisma.installation.create({ data: { storeId: store.id, grantedScopes: opts.scopes, apiVersion: opts.apiVersion } });
      return store;
    }
    return existing;
  }
  logger.info({ shopDomain: domain }, "store installed");
  return prisma.$transaction(async (tx) => {
    const org = await tx.organization.create({ data: { name: domain } });
    const store = await tx.store.create({ data: { organizationId: org.id, shopDomain: domain } });
    await tx.installation.create({ data: { storeId: store.id, grantedScopes: opts.scopes, apiVersion: opts.apiVersion } });
    await tx.feeConfig.create({ data: { storeId: store.id } });
    await tx.taxConfig.create({ data: { storeId: store.id, treatment: "UNCONFIGURED" } });
    await tx.notificationPreference.create({ data: { storeId: store.id } });
    await tx.subscription.create({ data: { storeId: store.id, planKey: "free" } });
    return store;
  });
}

export async function markUninstalled(shopDomain: string): Promise<void> {
  const domain = shopDomain.toLowerCase();
  const store = await prisma.store.findUnique({ where: { shopDomain: domain } });
  if (!store) return;
  await prisma.$transaction([
    prisma.store.update({ where: { id: store.id }, data: { status: "UNINSTALLED", uninstalledAt: new Date() } }),
    prisma.installation.updateMany({ where: { storeId: store.id, uninstalledAt: null }, data: { uninstalledAt: new Date() } }),
    prisma.subscription.updateMany({ where: { storeId: store.id }, data: { status: "CANCELLED", cancelledAt: new Date() } }),
    prisma.syncJob.updateMany({ where: { storeId: store.id, status: { in: ["QUEUED", "RUNNING"] } }, data: { status: "CANCELLED", finishedAt: new Date() } }),
    // Third-party ad credentials are removed immediately on uninstall.
    prisma.adAccount.updateMany({ where: { storeId: store.id }, data: { credentialsEnc: null, status: "DISCONNECTED" } }),
    prisma.session.deleteMany({ where: { shop: domain } }),
  ]);
}

/** Hard-delete all data for a store (shop/redact). */
export async function redactStore(shopDomain: string): Promise<boolean> {
  const domain = shopDomain.toLowerCase();
  const store = await prisma.store.findUnique({ where: { shopDomain: domain }, include: { organization: { include: { stores: true } } } });
  if (!store) return false;
  await prisma.$transaction(async (tx) => {
    await tx.store.delete({ where: { id: store.id } }); // cascades to all tenant tables
    if (store.organization.stores.length === 1) {
      await tx.organization.delete({ where: { id: store.organizationId } });
    }
    await tx.session.deleteMany({ where: { shop: domain } });
  });
  return true;
}

/** Remove customer identifiers (customers/redact). Orders remain as anonymous financial records. */
export async function redactCustomer(storeId: string, customerShopifyIds: string[], orderShopifyIds: string[]): Promise<number> {
  const result = await prisma.order.updateMany({
    where: {
      storeId,
      OR: [{ customerShopifyId: { in: customerShopifyIds } }, { shopifyId: { in: orderShopifyIds } }],
    },
    data: { customerShopifyId: null, customerEmailHash: null },
  });
  return result.count;
}

export async function audit(params: { storeId?: string | null; actorType: "user" | "system" | "webhook" | "admin"; actorId?: string | null; action: string; targetType?: string; targetId?: string; metadata?: Record<string, unknown> }) {
  await prisma.auditEvent.create({
    data: {
      storeId: params.storeId ?? null,
      actorType: params.actorType,
      actorId: params.actorId ?? null,
      action: params.action,
      targetType: params.targetType,
      targetId: params.targetId,
      metadata: params.metadata ? JSON.parse(JSON.stringify(params.metadata)) : undefined,
    },
  });
}
