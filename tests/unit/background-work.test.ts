import { beforeEach, expect, it, vi } from "vitest";
const query = vi.hoisted(() => vi.fn());
vi.mock("../../app/db.server", () => ({
  default: { syncJob: { groupBy: query } },
}));
import { backgroundWorkForShop } from "../../app/services/background-work.server";
beforeEach(() => vi.resetAllMocks());

it("scopes pending work to the authenticated active shop and omits completed/failed jobs", async () => {
  query.mockResolvedValue([{ type: "RECALCULATE", _count: { _all: 1 } }]);
  expect(await backgroundWorkForShop("Merchant.myshopify.com")).toEqual({
    active: true,
    recalculating: true,
  });
  expect(query).toHaveBeenCalledWith({
    by: ["type"],
    where: {
      store: { shopDomain: "merchant.myshopify.com", status: "ACTIVE" },
      status: { in: ["QUEUED", "RUNNING"] },
    },
    _count: { _all: true },
  });
});

it("stops polling when no jobs remain active", async () => {
  query.mockResolvedValue([]);
  expect(await backgroundWorkForShop("merchant.myshopify.com")).toEqual({
    active: false,
    recalculating: false,
  });
});

it("shows syncing rather than recalculating for import work", async () => {
  query.mockResolvedValue([{ type: "HISTORICAL_ORDERS", _count: { _all: 1 } }]);
  expect(await backgroundWorkForShop("merchant.myshopify.com")).toEqual({
    active: true,
    recalculating: false,
  });
});
