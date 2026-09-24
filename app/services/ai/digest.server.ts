import { requirePlanFeature } from "../billing.server";
import { requireReadyReport } from "../report-readiness.server";
import prisma from "../../db.server";
import { logger } from "../../lib/logger.server";
import { previousPeriod, resolvePeriod } from "../../lib/dates";
import { buildGrounding, type GroundingPack } from "./grounding.server";
import {
  AiUnavailableError,
  complete,
  estimateCostMicros,
} from "./provider.server";
import { validateAnswer } from "./ask.server";

const DIGEST_PROMPT = `You write a short weekly profit briefing for a Shopify merchant.
Use ONLY figures from DATA, quoted exactly. Structure:
1. One-sentence headline on net profit and its change versus the previous period.
2. Up to three "what moved" bullets built from the drivers list, phrased as associations (not causes).
3. Up to two open profit leaks worth attention, if any.
4. One line on data reliability using the confidence label and the most important caveat.
Maximum 160 words. Plain text, no markdown headers.`;

/** Deterministic digest used when AI is off or fails — still a useful briefing. */
export function deterministicDigest(g: GroundingPack): string {
  const m = g.metrics;
  const np = g.deltas.netProfit;
  const parts = [
    `Net profit for ${g.period.start}–${g.period.end} was ${m.netProfit}${np.changePct !== null ? ` (${np.changePct > 0 ? "+" : ""}${np.changePct}% vs ${np.previous} the period before)` : ""}, on net sales of ${m.netSales} from ${m.orders} orders.`,
  ];
  if (g.drivers.length)
    parts.push(`What moved: ${g.drivers.slice(0, 3).join("; ")}.`);
  if (g.openLeaks.length)
    parts.push(
      `Open leaks: ${g.openLeaks
        .slice(0, 2)
        .map((l) => `${l.title}${l.impact ? ` (${l.impact})` : ""}`)
        .join("; ")}.`,
    );
  parts.push(
    `Profit Confidence: ${g.confidence.label} (${g.confidence.score}/100).${g.confidence.caveats[0] ? ` ${g.confidence.caveats[0]}` : ""}`,
  );
  return parts.join(" ");
}

export async function generateWeeklyDigest(
  storeId: string,
): Promise<{ id: string; summary: string }> {
  await requirePlanFeature(storeId, "digest");
  const store = await prisma.store.findUniqueOrThrow({
    where: { id: storeId },
    select: { ianaTimezone: true, aiEnabled: true },
  });
  const period = resolvePeriod("7d", store.ianaTimezone);
  await requireReadyReport(storeId, period);
  const existing = await prisma.intelligenceDigest.findUnique({
    where: {
      storeId_kind_periodStart: {
        storeId,
        kind: "WEEKLY",
        periodStart: period.start,
      },
    },
  });
  if (existing) return { id: existing.id, summary: existing.summary };

  const grounding = await buildGrounding(storeId, "7d");
  const { allowedNumbers: _omit, ...data } = grounding;
  void _omit;
  let summary: string;
  try {
    if (!store.aiEnabled)
      throw new AiUnavailableError("AI sharing is disabled for this store");
    const result = await complete(
      [
        { role: "system", content: DIGEST_PROMPT },
        { role: "system", content: `DATA:\n${JSON.stringify(data)}` },
        { role: "user", content: "Write this week's briefing." },
      ],
      { tier: "strong", maxOutputTokens: 350 },
    );
    const v = validateAnswer(result.text, grounding);
    summary =
      v.ok && result.text.trim()
        ? result.text.trim()
        : deterministicDigest(grounding);
    await prisma.aiUsage.create({
      data: {
        storeId,
        feature: "digest",
        provider: result.provider,
        model: result.model,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        costMicros: estimateCostMicros(
          result.provider,
          result.model,
          result.inputTokens,
          result.outputTokens,
        ),
        latencyMs: result.latencyMs,
        success: v.ok,
      },
    });
    if (!v.ok)
      logger.warn(
        { storeId, unverified: v.unverifiedNumbers },
        "digest failed validation; used deterministic text",
      );
  } catch (err) {
    if (!(err instanceof AiUnavailableError))
      logger.warn(
        { storeId, err: (err as Error).message },
        "digest: provider failed",
      );
    summary = deterministicDigest(grounding);
  }
  const row = await prisma.intelligenceDigest.create({
    data: {
      storeId,
      kind: "WEEKLY",
      periodStart: period.start,
      periodEnd: period.end,
      metricsJson: JSON.parse(
        JSON.stringify({ ...data, previous: previousPeriod(period) }),
      ),
      summary,
    },
  });
  return { id: row.id, summary };
}

/**
 * Hourly scheduler tick: generate weekly digests for stores whose local time
 * matches their delivery hour on Monday. Delivery (email) is handled by the
 * notifications service once a provider is configured; here we persist them
 * so they appear in-app.
 */
export async function runDueDigests(now = new Date()): Promise<number> {
  const stores = await prisma.store.findMany({
    where: {
      status: "ACTIVE",
      notificationPref: { weeklyDigest: true },
      syncJobs: { some: { type: "HISTORICAL_ORDERS", status: "COMPLETED" } },
    },
    select: {
      id: true,
      ianaTimezone: true,
      notificationPref: { select: { deliveryHour: true } },
    },
  });
  let n = 0;
  for (const s of stores) {
    const local = new Intl.DateTimeFormat("en-US", {
      timeZone: s.ianaTimezone,
      hour: "numeric",
      hour12: false,
      weekday: "short",
    }).formatToParts(now);
    const hour = Number(local.find((p) => p.type === "hour")?.value ?? -1) % 24;
    const weekday = local.find((p) => p.type === "weekday")?.value;
    if (weekday !== "Mon" || hour !== (s.notificationPref?.deliveryHour ?? 8))
      continue;
    try {
      await generateWeeklyDigest(s.id);
      n++;
    } catch (err) {
      if (err instanceof Response && err.status === 403) continue;
      logger.error(
        { storeId: s.id, err: (err as Error).message },
        "digest generation failed",
      );
    }
  }
  return n;
}
