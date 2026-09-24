import type { CogsSource } from "@prisma/client";
import { z } from "zod";
import { requirePlanFeature } from "./billing.server";
import prisma from "../db.server";
import { toDecimalString, toMinor } from "../lib/money";
import { audit } from "./store.server";
import { enqueueRecalculate } from "./jobs/queue.server";

export interface CogsEntry {
  variantId: string;
  unitCost: string; // decimal string in store currency
  effectiveFrom: Date;
  note?: string | null;
}

/**
 * Record an effective-dated cost for variants. Existing history is never
 * overwritten unless the same (variant, effectiveFrom) is supplied — that is
 * an intentional correction. A recalculation from the earliest effective date
 * is queued so past orders reflect the change.
 */
export async function setCogs(
  storeId: string,
  entries: CogsEntry[],
  source: CogsSource,
  actorId: string | null,
): Promise<{ written: number; recalcFrom: Date | null }> {
  if (entries.length === 0) return { written: 0, recalcFrom: null };
  const store = await prisma.store.findUniqueOrThrow({
    where: { id: storeId },
    select: { currency: true },
  });
  const variantIds = [...new Set(entries.map((e) => e.variantId))];
  const owned = await prisma.variant.findMany({
    where: { storeId, id: { in: variantIds } },
    select: { id: true },
  });
  const ownedSet = new Set(owned.map((v) => v.id));
  const valid = entries.filter((e) => ownedSet.has(e.variantId));

  let earliest: Date | null = null;
  await prisma.$transaction(async (tx) => {
    for (const e of valid) {
      const unitCostMinor = toMinor(e.unitCost, store.currency);
      if (unitCostMinor < 0) continue;
      await tx.cogsHistory.upsert({
        where: {
          variantId_effectiveFrom: {
            variantId: e.variantId,
            effectiveFrom: e.effectiveFrom,
          },
        },
        create: {
          storeId,
          variantId: e.variantId,
          unitCostMinor,
          currency: store.currency,
          effectiveFrom: e.effectiveFrom,
          source,
          note: e.note ?? null,
        },
        update: { unitCostMinor, source, note: e.note ?? null },
      });
      if (!earliest || e.effectiveFrom < earliest) earliest = e.effectiveFrom;
    }
  });
  await audit({
    storeId,
    actorType: actorId ? "user" : "system",
    actorId,
    action: "cogs.set",
    metadata: { count: valid.length, source },
  });
  if (earliest) await enqueueRecalculate(storeId, earliest);
  return { written: valid.length, recalcFrom: earliest };
}

export async function deleteCogsRecord(
  storeId: string,
  id: string,
  actorId: string | null,
): Promise<void> {
  const rec = await prisma.cogsHistory.findFirst({ where: { id, storeId } });
  if (!rec) return;
  await prisma.cogsHistory.delete({ where: { id } });
  await audit({
    storeId,
    actorType: "user",
    actorId,
    action: "cogs.delete",
    targetType: "CogsHistory",
    targetId: id,
  });
  await enqueueRecalculate(storeId, rec.effectiveFrom);
}

// ---------------------------------------------------------------------------
// CSV import
// ---------------------------------------------------------------------------

const rowSchema = z.object({
  sku: z.string().trim().optional(),
  variant_id: z.string().trim().optional(),
  barcode: z.string().trim().optional(),
  unit_cost: z
    .string()
    .trim()
    .regex(/^-?\d+(\.\d+)?$/, "unit_cost must be a decimal number"),
  effective_from: z.iso.date(),
  note: z.string().trim().optional(),
});

export interface CsvImportPreview {
  matched: Array<{
    row: number;
    variantId: string;
    sku: string | null;
    title: string;
    unitCost: string;
    effectiveFrom: string;
    current: string | null;
  }>;
  unmatched: Array<{
    row: number;
    reason: string;
    raw: Record<string, string>;
  }>;
}

/** Minimal RFC4180 CSV parser (quotes, escaped quotes, CRLF). */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  if (rows.length === 0) return [];
  const header = rows[0].map((h) =>
    h
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, "_")
      .replace(/^\ufeff/, ""),
  );
  return rows
    .slice(1)
    .map((r) =>
      Object.fromEntries(header.map((h, i) => [h, (r[i] ?? "").trim()])),
    );
}

export async function previewCogsCsv(
  storeId: string,
  text: string,
  maxRows = 5_000,
): Promise<CsvImportPreview> {
  const records = parseCsv(text);
  if (records.length > maxRows)
    throw new Response(`Import at most ${maxRows} rows at a time`, {
      status: 400,
    });
  const preview: CsvImportPreview = { matched: [], unmatched: [] };
  if (records.length === 0) return preview;

  const skus = records.map((r) => r.sku).filter(Boolean);
  const barcodes = records.map((r) => r.barcode).filter(Boolean);
  const ids = records
    .map((r) => r.variant_id)
    .filter(Boolean)
    .map((v) =>
      v!.startsWith("gid://") ? v! : `gid://shopify/ProductVariant/${v}`,
    );
  const variants = await prisma.variant.findMany({
    where: {
      storeId,
      deletedAt: null,
      OR: [
        { sku: { in: skus as string[] } },
        { barcode: { in: barcodes as string[] } },
        { shopifyId: { in: ids } },
      ],
    },
    select: {
      id: true,
      sku: true,
      barcode: true,
      shopifyId: true,
      title: true,
      product: { select: { title: true } },
      cogs: {
        orderBy: { effectiveFrom: "desc" },
        take: 1,
        select: { unitCostMinor: true },
      },
    },
  });
  const store = await prisma.store.findUniqueOrThrow({
    where: { id: storeId },
    select: { currency: true },
  });
  const bySku = new Map(
    variants.filter((v) => v.sku).map((v) => [v.sku!.toLowerCase(), v]),
  );
  const byBarcode = new Map(
    variants.filter((v) => v.barcode).map((v) => [v.barcode!, v]),
  );
  const byId = new Map(variants.map((v) => [v.shopifyId, v]));

  records.forEach((raw, i) => {
    const rowNo = i + 2;
    const parsed = rowSchema.safeParse(raw);
    if (!parsed.success) {
      preview.unmatched.push({
        row: rowNo,
        reason: parsed.error.issues.map((e) => e.message).join("; "),
        raw,
      });
      return;
    }
    const r = parsed.data;
    if (
      !r.variant_id &&
      ((r.sku &&
        variants.filter((v) => v.sku?.toLowerCase() === r.sku!.toLowerCase())
          .length > 1) ||
        (r.barcode &&
          variants.filter((v) => v.barcode === r.barcode).length > 1))
    ) {
      preview.unmatched.push({
        row: rowNo,
        reason: "Ambiguous SKU or barcode; use variant_id",
        raw,
      });
      return;
    }
    const v =
      (r.variant_id &&
        byId.get(
          r.variant_id.startsWith("gid://")
            ? r.variant_id
            : `gid://shopify/ProductVariant/${r.variant_id}`,
        )) ||
      (r.sku && bySku.get(r.sku.toLowerCase())) ||
      (r.barcode && byBarcode.get(r.barcode));
    if (!v) {
      preview.unmatched.push({
        row: rowNo,
        reason: "No variant matched by variant_id, sku or barcode",
        raw,
      });
      return;
    }
    const eff = r.effective_from
      ? new Date(r.effective_from)
      : new Date("2000-01-01T00:00:00Z");
    if (Number.isNaN(eff.getTime())) {
      preview.unmatched.push({
        row: rowNo,
        reason: "effective_from is not a valid date (use YYYY-MM-DD)",
        raw,
      });
      return;
    }
    if (Number(r.unit_cost) < 0) {
      preview.unmatched.push({
        row: rowNo,
        reason: "unit_cost cannot be negative",
        raw,
      });
      return;
    }
    preview.matched.push({
      row: rowNo,
      variantId: v.id,
      sku: v.sku,
      title: `${v.product.title}${v.title && v.title !== "Default Title" ? ` — ${v.title}` : ""}`,
      unitCost: r.unit_cost,
      effectiveFrom: eff.toISOString().slice(0, 10),
      current: v.cogs[0]
        ? toDecimalString(v.cogs[0].unitCostMinor, store.currency)
        : null,
    });
  });
  return preview;
}

export async function importCogsCsv(
  storeId: string,
  text: string,
  actorId: string | null,
) {
  const preview = await previewCogsCsv(storeId, text);
  const result = await setCogs(
    storeId,
    preview.matched.map((m) => ({
      variantId: m.variantId,
      unitCost: m.unitCost,
      effectiveFrom: new Date(m.effectiveFrom),
      note: "CSV import",
    })),
    "CSV_IMPORT",
    actorId,
  );
  return {
    ...result,
    skipped: preview.unmatched.length,
    unmatched: preview.unmatched,
  };
}

/** Export current variants with latest cost, for editing offline and re-importing. */
export async function exportCogsCsv(storeId: string): Promise<string> {
  await requirePlanFeature(storeId, "csvExport");
  const [store, variants] = await Promise.all([
    prisma.store.findUniqueOrThrow({
      where: { id: storeId },
      select: { currency: true },
    }),
    prisma.variant.findMany({
      where: { storeId, deletedAt: null },
      include: {
        product: { select: { title: true } },
        cogs: { orderBy: { effectiveFrom: "desc" }, take: 1 },
      },
      orderBy: [{ product: { title: "asc" } }, { title: "asc" }],
    }),
  ]);
  const esc = (s: string | null | undefined) =>
    `"${(s ?? "").replace(/"/g, '""')}"`;
  const lines = [
    "variant_id,sku,barcode,product,variant,unit_cost,effective_from,note",
  ];
  for (const v of variants) {
    const cur = v.cogs[0];
    lines.push(
      [
        esc(v.shopifyId.split("/").pop()),
        esc(v.sku),
        esc(v.barcode),
        esc(v.product.title),
        esc(v.title),
        cur
          ? toDecimalString(cur.unitCostMinor, store.currency)
          : v.shopifyUnitCostMinor !== null
            ? toDecimalString(v.shopifyUnitCostMinor, store.currency)
            : "",
        cur ? cur.effectiveFrom.toISOString().slice(0, 10) : "",
        esc(cur?.note),
      ].join(","),
    );
  }
  return lines.join("\n");
}

/** Variants that have been sold but have no cost anywhere (history or Shopify). */
export async function missingCogsVariants(storeId: string, since: Date) {
  return prisma.variant.findMany({
    where: {
      storeId,
      deletedAt: null,
      cogs: { none: {} },
      shopifyUnitCostMinor: null,
      lineItems: {
        some: { order: { processedAt: { gte: since }, isTest: false } },
      },
    },
    select: {
      id: true,
      title: true,
      sku: true,
      shopifyId: true,
      priceMinor: true,
      product: { select: { id: true, title: true, imageUrl: true } },
      _count: { select: { lineItems: true } },
    },
    orderBy: { lineItems: { _count: "desc" } },
    take: 500,
  });
}
