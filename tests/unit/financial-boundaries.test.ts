import { describe, expect, it } from "vitest";
import { computeOrderProfit } from "../../app/domain/profit/order";
import { summarizePeriod } from "../../app/domain/profit/aggregate";
import { microsToMinor } from "../../app/services/ads/google.server";
import { ctx, order, D } from "../fixtures/orders";

describe("currency boundaries", () => {
  it("rejects a calculation using costs from a different currency", () => {
    expect(() => computeOrderProfit(order({ currency: "USD" }), ctx())).toThrow(
      /currency/,
    );
  });
  it("rejects mixed-currency order aggregates", () => {
    const profit = computeOrderProfit(order(), ctx());
    expect(() =>
      summarizePeriod({
        currency: "USD",
        periodStart: D("2026-05-01"),
        periodEnd: D("2026-06-01"),
        orders: [profit],
        expenses: [],
        adSpendMinor: 0,
      }),
    ).toThrow(/currencies/);
  });
  it.each([
    ["JPY", 1],
    ["HUF", 123],
    ["TWD", 123],
    ["KWD", 1234],
    ["EUR", 123],
  ])(
    "converts Google micros in %s using the shared money rules",
    (currency, expected) => {
      expect(microsToMinor("1234000", currency)).toBe(expected);
    },
  );
  it("rejects unsafe advertising totals instead of losing precision", () => {
    expect(() => microsToMinor("999999999999999999999999999", "EUR")).toThrow(
      /safe integer/,
    );
  });
});
