import { z } from "zod";
import type { Prisma } from "@prisma/client";
import prisma from "../db.server";

// Reject imprecise numeric IDs instead of exporting a potentially wrong record.
const identifier = z
  .union([
    z.string().regex(/^\d+$/),
    z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  ])
  .transform(String);
const requestPayload = z.object({
  data_request: z.object({ id: identifier }),
  customer: z.object({ id: identifier.optional() }).optional(),
  orders_requested: z.array(identifier).default([]),
});

export async function recordPrivacyRequest(
  storeId: string,
  raw: unknown,
  receivedAt: Date,
) {
  const payload = requestPayload.parse(raw);
  return prisma.privacyRequest.upsert({
    where: {
      storeId_requestId: { storeId, requestId: payload.data_request.id },
    },
    create: {
      storeId,
      requestId: payload.data_request.id,
      customerShopifyId: payload.customer?.id
        ? `gid://shopify/Customer/${payload.customer.id}`
        : null,
      requestedOrderShopifyIds: [...new Set(payload.orders_requested)].map(
        (id) => `gid://shopify/Order/${id}`,
      ),
      receivedAt,
      dueAt: new Date(receivedAt.getTime() + 30 * 86_400_000),
    },
    update: {}, // Retries must not reset deadlines or reopen fulfilled requests.
  });
}

export async function requirePrivacyRequest(storeId: string, id: string) {
  const record = await prisma.privacyRequest.findFirst({
    where: { id, storeId, status: "PENDING" },
  });
  if (!record) throw new Response("Pending request not found", { status: 404 });
  return record;
}

export async function fulfillPrivacyRequest(storeId: string, id: string) {
  return prisma.$transaction(async (tx) => {
    const updated = await tx.privacyRequest.updateMany({
      where: { id, storeId, status: "PENDING" },
      data: {
        status: "FULFILLED",
        fulfilledAt: new Date(),
        customerShopifyId: null,
        requestedOrderShopifyIds: [],
      },
    });
    if (!updated.count)
      throw new Response("Pending request not found", { status: 404 });
    await tx.auditEvent.create({
      data: {
        storeId,
        actorType: "user",
        action: "privacy.request_fulfilled",
        targetType: "privacy_request",
        targetId: id,
      },
    });
  });
}

/** Retrieve only data linked to a verified webhook request in the authenticated tenant. */
export async function privacyExportPage(
  storeId: string,
  requestId: string,
  after?: string,
) {
  const record = await requirePrivacyRequest(storeId, requestId);
  const subjects: Prisma.OrderWhereInput[] = [];
  if (record.customerShopifyId)
    subjects.push({ customerShopifyId: record.customerShopifyId });
  if (record.requestedOrderShopifyIds.length)
    subjects.push({ shopifyId: { in: record.requestedOrderShopifyIds } });
  if (!subjects.length) return { orders: [], nextCursor: null };
  const orders = await prisma.order.findMany({
    where: { storeId, OR: subjects, ...(after ? { id: { gt: after } } : {}) },
    orderBy: { id: "asc" },
    take: 101,
    include: { lineItems: true, refunds: true, transactions: true },
  });
  const more = orders.length > 100;
  const selected = orders.slice(0, 100);
  return {
    orders: selected,
    nextCursor: more ? selected[selected.length - 1].id : null,
  };
}
