import prisma from "../db.server";

/** The shop domain must come from the verified session, never request parameters. */
export async function backgroundWorkForShop(shopDomain: string) {
  const groups = await prisma.syncJob.groupBy({
    by: ["type"],
    where: {
      store: { shopDomain: shopDomain.toLowerCase(), status: "ACTIVE" },
      status: { in: ["QUEUED", "RUNNING"] },
    },
    _count: { _all: true },
  });
  return {
    active: groups.some((group) => group._count._all > 0),
    recalculating: groups.some(
      (group) => group.type === "RECALCULATE" && group._count._all > 0,
    ),
  };
}
