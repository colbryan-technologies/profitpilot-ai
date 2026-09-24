/**
 * Money primitives.
 *
 * All amounts flow through the system as integers in the currency's minor unit
 * (cents, pence, kobo…). Decimal strings coming from Shopify ("12.34") are
 * parsed with decimal.js — never with parseFloat — and converted to minor units
 * exactly. Divisions (allocations, fee percentages) use banker's-safe integer
 * math with explicit rounding, and allocations always sum to the original total.
 */
import Decimal from "decimal.js";

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN });

/** ISO-4217 minor unit exponents that differ from the default of 2. */
const MINOR_UNIT_EXPONENTS: Record<string, number> = {
  BHD: 3,
  IQD: 3,
  JOD: 3,
  KWD: 3,
  LYD: 3,
  OMR: 3,
  TND: 3,
  BIF: 0,
  CLP: 0,
  DJF: 0,
  GNF: 0,
  ISK: 0,
  JPY: 0,
  KMF: 0,
  KRW: 0,
  PYG: 0,
  RWF: 0,
  UGX: 0,
  UYI: 0,
  VND: 0,
  VUV: 0,
  XAF: 0,
  XOF: 0,
  XPF: 0,
};

export type CurrencyCode = string;

export interface Money {
  /** Integer amount in minor units. */
  amount: number;
  currency: CurrencyCode;
}

export function minorUnitExponent(currency: CurrencyCode): number {
  return MINOR_UNIT_EXPONENTS[currency.toUpperCase()] ?? 2;
}

export function assertInteger(n: number, label = "amount"): void {
  if (!Number.isSafeInteger(n)) {
    throw new TypeError(`${label} must be a safe integer, got ${n}`);
  }
}

/** Parse a decimal string like "12.34" into minor units for the currency. */
export function toMinor(decimalString: string | number, currency: CurrencyCode): number {
  const d = new Decimal(decimalString);
  if (!d.isFinite()) throw new TypeError(`Invalid money value: ${decimalString}`);
  const scaled = d.mul(new Decimal(10).pow(minorUnitExponent(currency)));
  const rounded = scaled.toDecimalPlaces(0, Decimal.ROUND_HALF_EVEN);
  const n = rounded.toNumber();
  assertInteger(n, "parsed money");
  return n;
}

/** Format minor units to a plain decimal string ("12.34"). */
export function toDecimalString(minor: number, currency: CurrencyCode): string {
  assertInteger(minor);
  const exp = minorUnitExponent(currency);
  return new Decimal(minor).div(new Decimal(10).pow(exp)).toFixed(exp);
}

export function money(amount: number, currency: CurrencyCode): Money {
  assertInteger(amount);
  return { amount, currency: currency.toUpperCase() };
}

export function zero(currency: CurrencyCode): Money {
  return money(0, currency);
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new Error(`Currency mismatch: ${a.currency} vs ${b.currency}`);
  }
}

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amount + b.amount, a.currency);
}

export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amount - b.amount, a.currency);
}

export function sum(items: Money[], currency: CurrencyCode): Money {
  return items.reduce((acc, m) => add(acc, m), zero(currency));
}

export function negate(a: Money): Money {
  return money(-a.amount, a.currency);
}

export function multiply(a: Money, factor: number): Money {
  const result = new Decimal(a.amount).mul(factor).toDecimalPlaces(0, Decimal.ROUND_HALF_EVEN);
  return money(result.toNumber(), a.currency);
}

/**
 * Apply a percentage expressed in basis points (1 bp = 0.01%).
 * e.g. percentBps(10_000 minor, 290) = 290 minor (2.90%).
 */
export function percentBps(minor: number, bps: number): number {
  assertInteger(minor);
  assertInteger(bps, "bps");
  return new Decimal(minor).mul(bps).div(10_000).toDecimalPlaces(0, Decimal.ROUND_HALF_EVEN).toNumber();
}

/**
 * Allocate `total` across `weights` proportionally using the largest-remainder
 * method so that the parts always sum exactly to `total`.
 */
export function allocate(total: number, weights: number[]): number[] {
  assertInteger(total, "total");
  if (weights.length === 0) return [];
  const weightSum = weights.reduce((a, b) => a + b, 0);
  if (weightSum <= 0) {
    // Even split when no weights.
    return allocate(
      total,
      weights.map(() => 1),
    );
  }
  const raw = weights.map((w) => new Decimal(total).mul(w).div(weightSum));
  const floors = raw.map((r) => (total >= 0 ? r.floor() : r.ceil()).toNumber());
  let remainder = total - floors.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r.minus(floors[i]).abs().toNumber() }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  const step = total >= 0 ? 1 : -1;
  for (const { i } of order) {
    if (remainder === 0) break;
    floors[i] += step;
    remainder -= step;
  }
  return floors;
}

/** Ratio as a number for display (e.g. margin) — never used for money math. */
export function ratio(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return new Decimal(numerator).div(denominator).toDecimalPlaces(6).toNumber();
}

/** Percentage (0-100) with 1 decimal; null when denominator is 0. */
export function percentage(numerator: number, denominator: number): number | null {
  const r = ratio(numerator, denominator);
  return r === null ? null : new Decimal(r).mul(100).toDecimalPlaces(1).toNumber();
}

/** Percentage change from `previous` to `current`. */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return new Decimal(current - previous).div(Math.abs(previous)).mul(100).toDecimalPlaces(1).toNumber();
}

const formatterCache = new Map<string, Intl.NumberFormat>();

export function formatMoney(minor: number, currency: CurrencyCode, locale = "en", opts?: { compact?: boolean }): string {
  const key = `${locale}|${currency}|${opts?.compact ? "c" : "f"}`;
  let fmt = formatterCache.get(key);
  if (!fmt) {
    fmt = new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      notation: opts?.compact ? "compact" : "standard",
      maximumFractionDigits: opts?.compact ? 1 : undefined,
    });
    formatterCache.set(key, fmt);
  }
  return fmt.format(Number(toDecimalString(minor, currency)));
}
