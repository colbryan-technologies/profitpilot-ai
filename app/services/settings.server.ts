import { z } from "zod";
import prisma from "../db.server";
import { toMinor } from "../lib/money";
import { audit } from "./store.server";
import { enqueueRecalculate } from "./jobs/queue.server";

const decimal = z.string().trim().regex(/^-?\d+(\.\d+)?$/, "Enter a number");
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------

export const expenseSchema = z.object({
  name: z.string().trim().min(1).max(120),
  category: z.enum(["SOFTWARE", "WAREHOUSE", "CONTRACTORS", "PACKAGING", "FULFILLMENT", "PAYROLL", "AGENCY", "MARKETING_OTHER", "OTHER"]),
  amount: decimal,
  recurrence: z.enum(["ONE_TIME", "DAILY", "WEEKLY", "MONTHLY", "YEARLY"]),
  startsOn: ymd,
  endsOn: ymd.optional().or(z.literal("")),
  allocation: z.enum(["STORE", "PER_ORDER"]).default("STORE"),
  note: z.string().trim().max(500).optional(),
});
export type ExpenseForm = z.infer<typeof expenseSchema>;

export async function upsertExpense(storeId: string, form: ExpenseForm, actorId: string | null, id?: string) {
  const store = await prisma.store.findUniqueOrThrow({ where: { id: storeId }, select: { currency: true } });
  const amountMinor = toMinor(form.amount, store.currency);
  if (amountMinor < 0) throw new Response("Amount cannot be negative", { status: 400 });
  const data = {
    name: form.name,
    category: form.category,
    amountMinor,
    currency: store.currency,
    recurrence: form.recurrence,
    startsOn: new Date(`${form.startsOn}T00:00:00Z`),
    endsOn: form.endsOn ? new Date(`${form.endsOn}T00:00:00Z`) : null,
    allocation: form.allocation,
    note: form.note ?? null,
  };
  if (data.endsOn && data.endsOn < data.startsOn) throw new Response("End date must be after start date", { status: 400 });
  let recalcFrom = data.startsOn;
  let row;
  if (id) {
    const existing = await prisma.expense.findFirst({ where: { id, storeId } });
    if (!existing) throw new Response("Not found", { status: 404 });
    if (existing.startsOn < recalcFrom) recalcFrom = existing.startsOn;
    row = await prisma.expense.update({ where: { id }, data });
  } else {
    row = await prisma.expense.create({ data: { storeId, ...data } });
  }
  await audit({ storeId, actorType: "user", actorId, action: id ? "expense.update" : "expense.create", targetType: "Expense", targetId: row.id });
  await enqueueRecalculate(storeId, recalcFrom);
  return row;
}

export async function deleteExpense(storeId: string, id: string, actorId: string | null) {
  const existing = await prisma.expense.findFirst({ where: { id, storeId } });
  if (!existing) return;
  await prisma.expense.delete({ where: { id } });
  await audit({ storeId, actorType: "user", actorId, action: "expense.delete", targetType: "Expense", targetId: id });
  await enqueueRecalculate(storeId, existing.startsOn);
}

// ---------------------------------------------------------------------------
// Fees
// ---------------------------------------------------------------------------

export const feeSchema = z.object({
  percent: decimal, // e.g. "2.9"
  fixed: decimal, // e.g. "0.30"
  overrides: z
    .array(z.object({ gateway: z.string().trim().min(1).max(60), percent: decimal, fixed: decimal }))
    .max(20)
    .default([]),
});

export async function saveFeeConfig(storeId: string, form: z.infer<typeof feeSchema>, actorId: string | null) {
  const store = await prisma.store.findUniqueOrThrow({ where: { id: storeId }, select: { currency: true } });
  const pctToBps = (s: string) => Math.round(Number(s) * 100);
  const overrides = Object.fromEntries(form.overrides.map((o) => [o.gateway.toLowerCase(), { percentBps: pctToBps(o.percent), fixedMinor: toMinor(o.fixed, store.currency) }]));
  await prisma.feeConfig.upsert({
    where: { storeId },
    create: { storeId, percentBps: pctToBps(form.percent), fixedMinor: toMinor(form.fixed, store.currency), gatewayOverrides: overrides, confirmedAt: new Date() },
    update: { percentBps: pctToBps(form.percent), fixedMinor: toMinor(form.fixed, store.currency), gatewayOverrides: overrides, confirmedAt: new Date() },
  });
  await audit({ storeId, actorType: "user", actorId, action: "fees.update" });
  await enqueueRecalculate(storeId, null);
}

// ---------------------------------------------------------------------------
// Shipping cost rules
// ---------------------------------------------------------------------------

export const shippingRuleSchema = z.object({
  name: z.string().trim().min(1).max(80),
  countryCode: z.string().trim().length(2).toUpperCase().optional().or(z.literal("")),
  flat: decimal.default("0"),
  perItem: decimal.default("0"),
  percent: decimal.default("0"),
  priority: z.coerce.number().int().min(0).max(1000).default(0),
});

export async function upsertShippingRule(storeId: string, form: z.infer<typeof shippingRuleSchema>, actorId: string | null, id?: string) {
  const store = await prisma.store.findUniqueOrThrow({ where: { id: storeId }, select: { currency: true } });
  const data = {
    name: form.name,
    countryCode: form.countryCode ? form.countryCode : null,
    flatMinor: toMinor(form.flat, store.currency),
    perItemMinor: toMinor(form.perItem, store.currency),
    percentBps: Math.round(Number(form.percent) * 100),
    currency: store.currency,
    priority: form.priority,
  };
  if (id) {
    const existing = await prisma.shippingCostRule.findFirst({ where: { id, storeId } });
    if (!existing) throw new Response("Not found", { status: 404 });
    await prisma.shippingCostRule.update({ where: { id }, data });
  } else {
    await prisma.shippingCostRule.create({ data: { storeId, ...data } });
  }
  await audit({ storeId, actorType: "user", actorId, action: "shipping_rule.save" });
  await enqueueRecalculate(storeId, null);
}

export async function deleteShippingRule(storeId: string, id: string, actorId: string | null) {
  const r = await prisma.shippingCostRule.deleteMany({ where: { id, storeId } });
  if (r.count) {
    await audit({ storeId, actorType: "user", actorId, action: "shipping_rule.delete", targetId: id });
    await enqueueRecalculate(storeId, null);
  }
}

// ---------------------------------------------------------------------------
// Tax
// ---------------------------------------------------------------------------

export const TAX_PRESETS: Record<string, { label: string; treatment: "EXCLUDE_COLLECTED_TAX" | "INCLUDE_TAX_AS_REVENUE"; notes: string }> = {
  GB: { label: "United Kingdom (VAT)", treatment: "EXCLUDE_COLLECTED_TAX", notes: "VAT collected is remitted to HMRC and excluded from revenue. Enter COGS and expenses net of reclaimable VAT if VAT-registered." },
  IE: { label: "Ireland (VAT)", treatment: "EXCLUDE_COLLECTED_TAX", notes: "VAT collected is excluded from revenue. Enter costs net of reclaimable VAT if VAT-registered." },
  EU: { label: "European Union (VAT/OSS)", treatment: "EXCLUDE_COLLECTED_TAX", notes: "VAT collected (including OSS destination VAT) is excluded from revenue. Enter costs net of reclaimable VAT." },
  US: { label: "United States (sales tax)", treatment: "EXCLUDE_COLLECTED_TAX", notes: "Sales tax collected is excluded from revenue. Costs are typically recorded gross." },
  NG: { label: "Nigeria (VAT)", treatment: "EXCLUDE_COLLECTED_TAX", notes: "VAT collected is excluded from revenue. Input VAT recoverability depends on registration; enter costs accordingly." },
  NONE: { label: "Not registered / no tax collected", treatment: "INCLUDE_TAX_AS_REVENUE", notes: "No tax is remitted separately; any tax amounts on orders are treated as revenue." },
};

export const taxSchema = z.object({
  regionCode: z.enum(["GB", "IE", "EU", "US", "NG", "NONE", "CUSTOM"]),
  treatment: z.enum(["EXCLUDE_COLLECTED_TAX", "INCLUDE_TAX_AS_REVENUE"]),
  cogsIncludesReclaimableTax: z.coerce.boolean().default(false),
  notes: z.string().trim().max(1000).optional(),
});

export async function saveTaxConfig(storeId: string, form: z.infer<typeof taxSchema>, actorId: string | null) {
  const preset = TAX_PRESETS[form.regionCode];
  await prisma.taxConfig.upsert({
    where: { storeId },
    create: { storeId, treatment: form.treatment, regionCode: form.regionCode, cogsIncludesReclaimableTax: form.cogsIncludesReclaimableTax, notes: form.notes || preset?.notes || null, confirmedAt: new Date() },
    update: { treatment: form.treatment, regionCode: form.regionCode, cogsIncludesReclaimableTax: form.cogsIncludesReclaimableTax, notes: form.notes || preset?.notes || null, confirmedAt: new Date() },
  });
  await audit({ storeId, actorType: "user", actorId, action: "tax.update", metadata: { treatment: form.treatment, regionCode: form.regionCode } });
  await enqueueRecalculate(storeId, null);
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export const notificationSchema = z.object({
  weeklyDigest: z.coerce.boolean().default(false),
  dailyDigest: z.coerce.boolean().default(false),
  leakAlerts: z.coerce.boolean().default(false),
  minLeakSeverity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).default("MEDIUM"),
  email: z.string().trim().email().optional().or(z.literal("")),
  deliveryHour: z.coerce.number().int().min(0).max(23).default(8),
});

export async function saveNotificationPrefs(storeId: string, form: z.infer<typeof notificationSchema>) {
  await prisma.notificationPreference.upsert({
    where: { storeId },
    create: { storeId, ...form, email: form.email || null },
    update: { ...form, email: form.email || null },
  });
}
