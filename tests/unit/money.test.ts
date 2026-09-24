import { describe, expect, it } from "vitest";
import { allocate, formatMoney, percentBps, percentChange, toDecimalString, toMinor } from "../../app/lib/money";

describe("money", () => {
  it("parses decimal strings exactly", () => {
    expect(toMinor("12.34", "EUR")).toBe(1234);
    expect(toMinor("0.1", "USD")).toBe(10);
    expect(toMinor("1000", "JPY")).toBe(1000);
    expect(toMinor("1.234", "KWD")).toBe(1234);
    expect(toMinor("19.995", "GBP")).toBe(2000); // half-even
    expect(toMinor("-5.50", "NGN")).toBe(-550);
  });

  it("rejects non-finite values", () => {
    expect(() => toMinor("abc", "EUR")).toThrow();
  });

  it("formats minor units to decimal strings", () => {
    expect(toDecimalString(1234, "EUR")).toBe("12.34");
    expect(toDecimalString(5, "EUR")).toBe("0.05");
    expect(toDecimalString(-550, "NGN")).toBe("-5.50");
    expect(toDecimalString(1000, "JPY")).toBe("1000");
  });

  it("applies basis points with half-even rounding", () => {
    expect(percentBps(10_000, 290)).toBe(290);
    expect(percentBps(10_001, 290)).toBe(290);
    expect(percentBps(1_000, 25)).toBe(2); // 2.5 → 2 (half-even)
    expect(percentBps(3_000, 25)).toBe(8); // 7.5 → 8
  });

  it("allocates without losing a cent", () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(100, [1, 1, 1]).reduce((a, b) => a + b)).toBe(100);
    expect(allocate(-100, [1, 1, 1]).reduce((a, b) => a + b)).toBe(-100);
    expect(allocate(1000, [0, 0])).toEqual([500, 500]);
    expect(allocate(999, [3, 1])).toEqual([749, 250]);
    expect(allocate(5, [])).toEqual([]);
  });

  it("computes percent change", () => {
    expect(percentChange(118, 100)).toBe(18);
    expect(percentChange(0, 0)).toBe(0);
    expect(percentChange(50, 0)).toBeNull();
    expect(percentChange(-50, -100)).toBe(50);
  });

  it("formats with Intl", () => {
    expect(formatMoney(1333000, "EUR", "en-IE")).toBe("€13,330.00");
    expect(formatMoney(150000, "NGN", "en")).toContain("1,500.00");
  });
});
