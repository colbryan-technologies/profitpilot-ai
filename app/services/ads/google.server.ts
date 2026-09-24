import { z } from "zod";
import { env } from "../../lib/env.server";
import { AdsProviderError, type AdsProvider, type DailySpend, type ProviderCredentials } from "./provider";

const ADS_API = "https://googleads.googleapis.com/v18";

const tokenSchema = z.object({ access_token: z.string(), refresh_token: z.string().optional(), expires_in: z.number() });
const customersSchema = z.object({ resourceNames: z.array(z.string()).default([]) });
const customerSchema = z.object({ results: z.array(z.object({ customer: z.object({ id: z.string(), descriptiveName: z.string().optional(), currencyCode: z.string(), manager: z.boolean().optional() }) })).default([]) });
const metricsSchema = z.object({
  results: z
    .array(
      z.object({
        segments: z.object({ date: z.string() }),
        metrics: z.object({ costMicros: z.string().optional(), impressions: z.string().optional(), clicks: z.string().optional(), conversionsValue: z.number().optional(), conversions: z.number().optional() }),
        customer: z.object({ currencyCode: z.string() }).optional(),
      }),
    )
    .default([]),
  nextPageToken: z.string().optional(),
});

function headers(creds: ProviderCredentials, loginCustomerId?: string): HeadersInit {
  return {
    Authorization: `Bearer ${creds.accessToken}`,
    "developer-token": env().GOOGLE_ADS_DEVELOPER_TOKEN,
    "Content-Type": "application/json",
    ...(loginCustomerId ? { "login-customer-id": loginCustomerId } : {}),
  };
}

async function call<T>(url: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (body as { error?: { message?: string } }).error?.message ?? (body as { error_description?: string }).error_description ?? "unknown";
    throw new AdsProviderError(`Google Ads API error ${res.status}: ${msg}`, res.status === 429 || res.status >= 500, res.status === 401);
  }
  return schema.parse(body);
}

/** Micros → currency minor units. Google reports cost in micros of the account currency. */
export function microsToMinor(micros: string | number, currency: string): number {
  const zeroDecimal = ["JPY", "KRW", "VND", "CLP", "ISK", "HUF", "TWD", "UGX", "XAF", "XOF", "PYG", "RWF"].includes(currency);
  const n = typeof micros === "string" ? BigInt(micros) : BigInt(Math.round(micros));
  const divisor = zeroDecimal ? 1_000_000n : 10_000n;
  const half = divisor / 2n;
  return Number((n + (n >= 0n ? half : -half)) / divisor);
}

export const googleAds: AdsProvider = {
  key: "GOOGLE",
  authorizeUrl(state, redirectUri) {
    const p = new URLSearchParams({
      client_id: env().GOOGLE_ADS_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "https://www.googleapis.com/auth/adwords",
      access_type: "offline",
      prompt: "consent",
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
  },
  async exchangeCode(code, redirectUri) {
    const body = new URLSearchParams({ code, client_id: env().GOOGLE_ADS_CLIENT_ID, client_secret: env().GOOGLE_ADS_CLIENT_SECRET, redirect_uri: redirectUri, grant_type: "authorization_code" });
    const t = await call("https://oauth2.googleapis.com/token", tokenSchema, { method: "POST", body, headers: { "Content-Type": "application/x-www-form-urlencoded" } });
    return { accessToken: t.access_token, refreshToken: t.refresh_token, expiresAt: new Date(Date.now() + t.expires_in * 1000).toISOString() };
  },
  async refresh(creds) {
    if (!creds.refreshToken) throw new AdsProviderError("No refresh token", false, true);
    const body = new URLSearchParams({ refresh_token: creds.refreshToken, client_id: env().GOOGLE_ADS_CLIENT_ID, client_secret: env().GOOGLE_ADS_CLIENT_SECRET, grant_type: "refresh_token" });
    const t = await call("https://oauth2.googleapis.com/token", tokenSchema, { method: "POST", body, headers: { "Content-Type": "application/x-www-form-urlencoded" } });
    return { ...creds, accessToken: t.access_token, expiresAt: new Date(Date.now() + t.expires_in * 1000).toISOString() };
  },
  async listAccounts(creds) {
    const list = await call(`${ADS_API}/customers:listAccessibleCustomers`, customersSchema, { headers: headers(creds) });
    const out: Array<{ externalId: string; name: string; currency: string }> = [];
    for (const rn of list.resourceNames) {
      const id = rn.split("/").pop()!;
      try {
        const r = await call(`${ADS_API}/customers/${id}/googleAds:search`, customerSchema, {
          method: "POST",
          headers: headers(creds, id),
          body: JSON.stringify({ query: "SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.manager FROM customer" }),
        });
        for (const row of r.results) {
          if (row.customer.manager) continue;
          out.push({ externalId: row.customer.id, name: row.customer.descriptiveName ?? row.customer.id, currency: row.customer.currencyCode });
        }
      } catch (err) {
        if (err instanceof AdsProviderError && !err.retryable) continue; // e.g. cancelled accounts
        throw err;
      }
    }
    return out;
  },
  async fetchDailySpend(creds, externalId, start, end) {
    const out: DailySpend[] = [];
    let pageToken: string | undefined;
    do {
      const r = await call(`${ADS_API}/customers/${externalId}/googleAds:search`, metricsSchema, {
        method: "POST",
        headers: headers(creds, creds.extra?.loginCustomerId),
        body: JSON.stringify({
          query: `SELECT segments.date, customer.currency_code, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value FROM customer WHERE segments.date BETWEEN '${start}' AND '${end}'`,
          pageToken,
        }),
      });
      for (const row of r.results) {
        const currency = row.customer?.currencyCode ?? "USD";
        out.push({
          date: row.segments.date,
          currency,
          spendMinor: microsToMinor(row.metrics.costMicros ?? "0", currency),
          impressions: row.metrics.impressions ? Number(row.metrics.impressions) : null,
          clicks: row.metrics.clicks ? Number(row.metrics.clicks) : null,
          attributedRevenueMinor: row.metrics.conversionsValue !== undefined ? microsToMinor(Math.round(row.metrics.conversionsValue * 1_000_000), currency) : null,
          attributedConversions: row.metrics.conversions !== undefined ? Math.round(row.metrics.conversions) : null,
        });
      }
      pageToken = r.nextPageToken;
    } while (pageToken);
    return out;
  },
};
