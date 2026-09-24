import type { Prisma } from "@prisma/client";
import { erasureHash } from "../lib/crypto.server";

/** Serialize erasure and ingestion for a tenant, including overlapping workers. */
export async function lockStore(tx: Prisma.TransactionClient, storeId: string) {
  const rows = await tx.$queryRaw<
    Array<{ id: string; status: string }>
  >`SELECT "id", "status" FROM "Store" WHERE "id" = ${storeId} FOR UPDATE`;
  return rows[0] ?? null;
}

export async function isErased(
  tx: Prisma.TransactionClient,
  storeId: string,
  ids: Array<string | null>,
) {
  const hashes = ids
    .filter((id): id is string => Boolean(id))
    .map((id) => erasureHash(storeId, id));
  return Boolean(
    await tx.erasureMarker.findFirst({
      where: { storeId, subjectHash: { in: hashes } },
      select: { subjectHash: true },
    }),
  );
}
