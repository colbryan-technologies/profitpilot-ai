import prisma from "../../db.server";
import type { MappedOrder, MappedProduct } from "./mappers";
import { isErased, lockStore } from "../erasure.server";

/**
 * Upsert an order and its children. Idempotent and safe under out-of-order
 * delivery: an incoming payload older than what we already stored is ignored
 * (webhooks can arrive out of sequence; `updatedAt` is monotonic on Shopify's side).
 */
export async function upsertOrder(
  storeId: string,
  mapped: MappedOrder,
  opts: { force?: boolean } = {},
): Promise<{ orderId: string | null; changed: boolean }> {
  const existing = await prisma.order.findUnique({
    where: {
      storeId_shopifyId: { storeId, shopifyId: mapped.order.shopifyId },
    },
    select: { id: true, shopifyUpdatedAt: true },
  });
  if (
    existing &&
    !opts.force &&
    existing.shopifyUpdatedAt > mapped.order.shopifyUpdatedAt
  ) {
    return { orderId: existing.id, changed: false };
  }

  const variantIds = mapped.lineItems
    .map((l) => l.shopifyVariantId)
    .filter((v): v is string => !!v);
  const productIds = mapped.lineItems
    .map((l) => l.shopifyProductId)
    .filter((v): v is string => !!v);
  const [variants, products] = await Promise.all([
    variantIds.length
      ? prisma.variant.findMany({
          where: { storeId, shopifyId: { in: variantIds } },
          select: { id: true, shopifyId: true },
        })
      : [],
    productIds.length
      ? prisma.product.findMany({
          where: { storeId, shopifyId: { in: productIds } },
          select: { id: true, shopifyId: true },
        })
      : [],
  ]);
  const variantMap = new Map(variants.map((v) => [v.shopifyId, v.id]));
  const productMap = new Map(products.map((p) => [p.shopifyId, p.id]));

  return prisma.$transaction(async (tx) => {
    const store = await lockStore(tx, storeId);
    if (
      !store ||
      store.status !== "ACTIVE" ||
      (await isErased(tx, storeId, [
        mapped.order.shopifyId,
        mapped.order.customerShopifyId,
      ]))
    )
      return { orderId: null, changed: false };
    const current = await tx.order.findUnique({
      where: {
        storeId_shopifyId: { storeId, shopifyId: mapped.order.shopifyId },
      },
      select: { id: true, shopifyUpdatedAt: true },
    });
    if (
      current &&
      !opts.force &&
      current.shopifyUpdatedAt > mapped.order.shopifyUpdatedAt
    )
      return { orderId: current.id, changed: false };
    const order = await tx.order.upsert({
      where: {
        storeId_shopifyId: { storeId, shopifyId: mapped.order.shopifyId },
      },
      create: { storeId, ...mapped.order, computedAt: null },
      update: { ...mapped.order, computedAt: null },
      select: { id: true },
    });

    for (const li of mapped.lineItems) {
      const data = {
        ...li,
        productId: li.shopifyProductId
          ? (productMap.get(li.shopifyProductId) ?? null)
          : null,
        variantId: li.shopifyVariantId
          ? (variantMap.get(li.shopifyVariantId) ?? null)
          : null,
      };
      await tx.lineItem.upsert({
        where: { storeId_shopifyId: { storeId, shopifyId: li.shopifyId } },
        create: { storeId, orderId: order.id, ...data },
        update: data,
      });
    }
    const keepLines = mapped.lineItems.map((l) => l.shopifyId);
    await tx.lineItem.deleteMany({
      where: { orderId: order.id, shopifyId: { notIn: keepLines } },
    });

    for (const r of mapped.refunds) {
      await tx.refund.upsert({
        where: { storeId_shopifyId: { storeId, shopifyId: r.shopifyId } },
        create: { storeId, orderId: order.id, ...r },
        update: r,
      });
    }
    for (const t of mapped.transactions) {
      await tx.transaction.upsert({
        where: { storeId_shopifyId: { storeId, shopifyId: t.shopifyId } },
        create: { storeId, orderId: order.id, ...t },
        update: t,
      });
    }
    return { orderId: order.id, changed: true };
  });
}

export async function upsertProduct(
  storeId: string,
  mapped: MappedProduct,
): Promise<string> {
  return prisma.$transaction(async (tx) => {
    const product = await tx.product.upsert({
      where: {
        storeId_shopifyId: { storeId, shopifyId: mapped.product.shopifyId },
      },
      create: { storeId, ...mapped.product, deletedAt: null },
      update: { ...mapped.product, deletedAt: null },
      select: { id: true },
    });
    for (const v of mapped.variants) {
      await tx.variant.upsert({
        where: { storeId_shopifyId: { storeId, shopifyId: v.shopifyId } },
        create: { storeId, productId: product.id, ...v, deletedAt: null },
        update: { productId: product.id, ...v, deletedAt: null },
      });
    }
    const keep = mapped.variants.map((v) => v.shopifyId);
    await tx.variant.updateMany({
      where: {
        productId: product.id,
        shopifyId: { notIn: keep },
        deletedAt: null,
      },
      data: { deletedAt: new Date() },
    });
    // Link any line items that arrived before the catalog did.
    await tx.lineItem.updateMany({
      where: {
        storeId,
        shopifyProductId: mapped.product.shopifyId,
        productId: null,
      },
      data: { productId: product.id },
    });
    for (const v of mapped.variants) {
      const variant = await tx.variant.findUnique({
        where: { storeId_shopifyId: { storeId, shopifyId: v.shopifyId } },
        select: { id: true },
      });
      if (variant)
        await tx.lineItem.updateMany({
          where: { storeId, shopifyVariantId: v.shopifyId, variantId: null },
          data: { variantId: variant.id },
        });
    }
    return product.id;
  });
}

export async function softDeleteProduct(
  storeId: string,
  shopifyId: string,
): Promise<void> {
  const product = await prisma.product.findUnique({
    where: { storeId_shopifyId: { storeId, shopifyId } },
    select: { id: true },
  });
  if (!product) return;
  await prisma.$transaction([
    prisma.product.update({
      where: { id: product.id },
      data: { deletedAt: new Date() },
    }),
    prisma.variant.updateMany({
      where: { productId: product.id },
      data: { deletedAt: new Date() },
    }),
  ]);
}

export async function deleteOrder(
  storeId: string,
  shopifyId: string,
): Promise<void> {
  await prisma.order.deleteMany({ where: { storeId, shopifyId } });
}
