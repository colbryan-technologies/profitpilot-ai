import type { AdAccount, AdProvider } from "@prisma/client";
import { storeEntitlements } from "../billing.server";
import { lockStore } from "../erasure.server";
import prisma from "../../db.server";
import { decrypt, encrypt } from "../../lib/crypto.server";
import { logger } from "../../lib/logger.server";
import { dayFromString } from "../../lib/dates";
import { toMinor } from "../../lib/money";
import { googleAds } from "./google.server";
import { metaAds } from "./meta.server";
import { rebuildSnapshots } from "../profit/recalc.server";
import {
  AdsProviderError,
  type AdsProvider,
  type ProviderCredentials,
} from "./provider";

const LOOKBACK_DAYS = 7; // platforms restate recent days; re-pull a rolling window

export function providerFor(key: AdProvider): AdsProvider {
  switch (key) {
    case "META":
      return metaAds;
    case "GOOGLE":
      return googleAds;
    default:
      throw new Error(`No provider implementation for ${key}`);
  }
}

export function readCredentials(
  account: AdAccount,
): ProviderCredentials | null {
  if (!account.credentialsEnc) return null;
  return JSON.parse(decrypt(account.credentialsEnc)) as ProviderCredentials;
}

export async function saveCredentials(
  accountId: string,
  creds: ProviderCredentials,
) {
  const account = await prisma.adAccount.findUniqueOrThrow({
    where: { id: accountId },
  });
  await connectAdAccount(
    account.storeId,
    account.provider,
    {
      externalId: account.externalId,
      name: account.name ?? "",
      currency: account.currency,
    },
    creds,
  );
}

export async function connectAdAccount(
  storeId: string,
  provider: AdProvider,
  info: { externalId: string; name: string; currency: string },
  creds: ProviderCredentials,
) {
  if (provider !== "META" && provider !== "GOOGLE")
    throw new Response("This advertising provider is not supported", {
      status: 400,
    });
  const { plan } = await storeEntitlements(storeId);
  return prisma.$transaction(async (tx) => {
    if (!(await lockStore(tx, storeId)))
      throw new Error("Store no longer exists");
    const accounts = await tx.adAccount.findMany({
      where: {
        storeId,
        provider: { not: "MANUAL" },
        status: { not: "DISCONNECTED" },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { provider: true, externalId: true },
    });
    const existing = accounts.findIndex(
      (a) => a.provider === provider && a.externalId === info.externalId,
    );
    if (
      plan.adAccounts === 0 ||
      (existing >= 0
        ? existing >= plan.adAccounts
        : accounts.length >= plan.adAccounts)
    )
      throw new Response(
        "Connected advertising account allowance reached. Manage your plan in Billing.",
        { status: 403 },
      );
    return tx.adAccount.upsert({
      where: {
        storeId_provider_externalId: {
          storeId,
          provider,
          externalId: info.externalId,
        },
      },
      create: {
        storeId,
        provider,
        externalId: info.externalId,
        name: info.name,
        currency: info.currency,
        credentialsEnc: encrypt(JSON.stringify(creds)),
        status: "CONNECTED",
      },
      update: {
        name: info.name,
        currency: info.currency,
        credentialsEnc: encrypt(JSON.stringify(creds)),
        status: "CONNECTED",
        lastSyncError: null,
      },
    });
  });
}

/** Sync a single ad account. Idempotent per (account, date). */
export async function syncAdAccount(
  accountId: string,
  opts: { days?: number } = {},
): Promise<{ days: number }> {
  const account = await prisma.adAccount.findUniqueOrThrow({
    where: { id: accountId },
  });
  if (account.provider === "MANUAL") return { days: 0 };
  const { plan } = await storeEntitlements(account.storeId);
  const allowed =
    plan.adAccounts > 0
      ? await prisma.adAccount.findMany({
          where: {
            storeId: account.storeId,
            provider: { not: "MANUAL" },
            status: { not: "DISCONNECTED" },
          },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          take: plan.adAccounts,
          select: { id: true },
        })
      : [];
  if (!allowed.some((a) => a.id === accountId)) return { days: 0 };
  const provider = providerFor(account.provider);
  let creds = readCredentials(account);
  if (!creds) {
    await prisma.adAccount.update({
      where: { id: accountId },
      data: { status: "NEEDS_REAUTH", lastSyncError: "Missing credentials" },
    });
    return { days: 0 };
  }
  const log = logger.child({
    adAccountId: accountId,
    provider: account.provider,
  });

  try {
    if (
      creds.expiresAt &&
      new Date(creds.expiresAt).getTime() - Date.now() < 24 * 3_600_000
    ) {
      creds = await provider.refresh(creds);
      await saveCredentials(accountId, creds);
    }
    const lookback = opts.days ?? (account.lastSyncedAt ? LOOKBACK_DAYS : 90);
    const end = new Date();
    const start = new Date(end.getTime() - lookback * 86_400_000);
    const rows = await provider.fetchDailySpend(
      creds,
      account.externalId,
      start.toISOString().slice(0, 10),
      end.toISOString().slice(0, 10),
    );
    for (const r of rows) {
      const date = dayFromString(r.date);
      const data = {
        currency: r.currency,
        spendMinor: r.spendMinor,
        impressions: r.impressions,
        clicks: r.clicks,
        attributedRevenueMinor: r.attributedRevenueMinor,
        attributedConversions: r.attributedConversions,
        syncedAt: new Date(),
      };
      await prisma.adSpend.upsert({
        where: { adAccountId_date: { adAccountId: accountId, date } },
        create: {
          storeId: account.storeId,
          adAccountId: accountId,
          date,
          ...data,
        },
        update: data,
      });
    }
    await prisma.adAccount.update({
      where: { id: accountId },
      data: {
        lastSyncedAt: new Date(),
        lastSyncError: null,
        status: "CONNECTED",
      },
    });
    log.info({ days: rows.length }, "ad spend synced");
    return { days: rows.length };
  } catch (err) {
    const message = (err as Error).message;
    const reauth = err instanceof AdsProviderError && err.reauthRequired;
    await prisma.adAccount.update({
      where: { id: accountId },
      data: {
        lastSyncError: message.slice(0, 1000),
        status: reauth ? "NEEDS_REAUTH" : "ERROR",
      },
    });
    log.error({ err: message, reauth }, "ad spend sync failed");
    if (err instanceof AdsProviderError && err.retryable) throw err;
    return { days: 0 };
  }
}

export async function syncAllAdAccounts(): Promise<number> {
  const accounts = await prisma.adAccount.findMany({
    where: {
      status: { in: ["CONNECTED", "ERROR"] },
      provider: { not: "MANUAL" },
      store: { status: "ACTIVE" },
    },
    select: { id: true, storeId: true },
  });
  const touched = new Set<string>();
  for (const a of accounts) {
    try {
      await syncAdAccount(a.id);
      touched.add(a.storeId);
    } catch (err) {
      logger.warn(
        { adAccountId: a.id, err: (err as Error).message },
        "ad sync deferred",
      );
    }
  }
  // Snapshots include ad spend, so refresh the recent window for stores with new data.
  for (const storeId of touched) {
    const days: string[] = [];
    for (let i = 0; i <= LOOKBACK_DAYS; i++)
      days.push(
        new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10),
      );
    await rebuildSnapshots(storeId, days);
  }
  return accounts.length;
}

/** Manual spend entry (CSV/form) for merchants without a connected platform. */
export async function recordManualSpend(
  storeId: string,
  rows: Array<{
    date: string;
    amount: string;
    currency: string;
    label?: string;
  }>,
): Promise<number> {
  const account = await prisma.adAccount.upsert({
    where: {
      storeId_provider_externalId: {
        storeId,
        provider: "MANUAL",
        externalId: "manual",
      },
    },
    create: {
      storeId,
      provider: "MANUAL",
      externalId: "manual",
      name: "Manual ad spend",
      currency: rows[0]?.currency ?? "USD",
      status: "CONNECTED",
    },
    update: {},
  });
  let n = 0;
  for (const r of rows) {
    const date = dayFromString(r.date);
    const spendMinor = toMinor(r.amount, r.currency);
    await prisma.adSpend.upsert({
      where: { adAccountId_date: { adAccountId: account.id, date } },
      create: {
        storeId,
        adAccountId: account.id,
        date,
        currency: r.currency,
        spendMinor,
      },
      update: { currency: r.currency, spendMinor, syncedAt: new Date() },
    });
    n++;
  }
  await prisma.adAccount.update({
    where: { id: account.id },
    data: { lastSyncedAt: new Date() },
  });
  await rebuildSnapshots(storeId, [...new Set(rows.map((r) => r.date))]);
  return n;
}
