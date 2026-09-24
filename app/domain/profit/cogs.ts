import type { CogsRecord, CogsResolver, CogsSourceKind } from "./types";

/**
 * In-memory effective-dated COGS resolver.
 *
 * Resolution order for a variant at time `at`:
 *  1. The latest history record with effectiveFrom <= at        → HISTORY
 *  2. If the order predates all history, the earliest record     → CURRENT
 *     (documented assumption: earliest known cost is the best estimate)
 *  3. Shopify inventory-item unit cost, if present                → SHOPIFY
 *  4. null                                                        → MISSING
 */
export class HistoryCogsResolver implements CogsResolver {
  private readonly history = new Map<string, CogsRecord[]>();
  private readonly shopifyCost = new Map<string, number>();

  constructor(records: Array<CogsRecord & { variantId: string }>, shopifyUnitCosts: Array<{ variantId: string; unitCostMinor: number }> = []) {
    for (const r of records) {
      const list = this.history.get(r.variantId) ?? [];
      list.push(r);
      this.history.set(r.variantId, list);
    }
    for (const list of this.history.values()) {
      list.sort((a, b) => a.effectiveFrom.getTime() - b.effectiveFrom.getTime());
    }
    for (const s of shopifyUnitCosts) this.shopifyCost.set(s.variantId, s.unitCostMinor);
  }

  resolve(variantId: string | null, at: Date): { unitCostMinor: number; source: CogsSourceKind } | null {
    if (!variantId) return null;
    const list = this.history.get(variantId);
    if (list && list.length > 0) {
      let match: CogsRecord | null = null;
      for (const r of list) {
        if (r.effectiveFrom.getTime() <= at.getTime()) match = r;
        else break;
      }
      if (match) return { unitCostMinor: match.unitCostMinor, source: "HISTORY" };
      return { unitCostMinor: list[0].unitCostMinor, source: "CURRENT" };
    }
    const shopify = this.shopifyCost.get(variantId);
    if (shopify !== undefined) return { unitCostMinor: shopify, source: "SHOPIFY" };
    return null;
  }
}

export const NO_COGS: CogsResolver = { resolve: () => null };
