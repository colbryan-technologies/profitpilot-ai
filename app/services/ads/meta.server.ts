import { z } from "zod";
import { env } from "../../lib/env.server";
import { toMinor } from "../../lib/money";
import { AdsProviderError, type AdsProvider, type DailySpend, type ProviderCredentials } from "./provider";

const GRAPH = "https://graph.facebook.com/v21.0";

const tokenSchema = z.object({ access_token: z.string(), expires_in: z.number().optional() });
const accountsSchema = z.object({
  data: z.array(z.object({ id: z.string(), name: z.string(), currency: z.string(), account_id: z.string() })),
  paging: z.object({ next: z.string().optional() }).optional(),
});
const insightsSchema = z.object({
  data: z.array(
    z.object({
      date_start: z.string(),
      spend: z.string().optional(),
      impressions: z.string().optional(),
      clicks: z.string().optional(),
      account_currency: z.string().optional(),
      action_values: z.array(z.object({ action_type: z.string(), value: z.string() })).optional(),
      actions: z.array(z.object({ action_type: z.string(), value: z.string() })).optional(),
    }),
  ),
  paging: z.object({ next: z.string().optional() }).optional(),
});

async function call<T>(url: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (body as { error?: { code?: number; message?: string; error_subcode?: number } }).error;
    const reauth = err?.code === 190; // invalid/expired token
    throw new AdsProviderError(`Meta API error ${res.status}: ${err?.message ?? "unknown"}`, res.status === 429 || res.status >= 500 || err?.code === 17 || err?.code === 4, reauth);
  }
  return schema.parse(body);
}

export const metaAds: AdsProvider = {
  key: "META",
  authorizeUrl(state, redirectUri) {
    const p = new URLSearchParams({ client_id: env().META_APP_ID, redirect_uri: redirectUri, state, scope: "ads_read", response_type: "code" });
    return `https://www.facebook.com/v21.0/dialog/oauth?${p}`;
  },
  async exchangeCode(code, redirectUri) {
    const p = new URLSearchParams({ client_id: env().META_APP_ID, client_secret: env().META_APP_SECRET, redirect_uri: redirectUri, code });
    const short = await call(`${GRAPH}/oauth/access_token?${p}`, tokenSchema);
    // Exchange for a long-lived (~60 day) token.
    const q = new URLSearchParams({ grant_type: "fb_exchange_token", client_id: env().META_APP_ID, client_secret: env().META_APP_SECRET, fb_exchange_token: short.access_token });
    const long = await call(`${GRAPH}/oauth/access_token?${q}`, tokenSchema);
    return { accessToken: long.access_token, expiresAt: long.expires_in ? new Date(Date.now() + long.expires_in * 1000).toISOString() : undefined };
  },
  async refresh(creds) {
    // Long-lived user tokens can be re-exchanged while still valid.
    const q = new URLSearchParams({ grant_type: "fb_exchange_token", client_id: env().META_APP_ID, client_secret: env().META_APP_SECRET, fb_exchange_token: creds.accessToken });
    const long = await call(`${GRAPH}/oauth/access_token?${q}`, tokenSchema);
    return { ...creds, accessToken: long.access_token, expiresAt: long.expires_in ? new Date(Date.now() + long.expires_in * 1000).toISOString() : creds.expiresAt };
  },
  async listAccounts(creds) {
    const out: Array<{ externalId: string; name: string; currency: string }> = [];
    let url: string | undefined = `${GRAPH}/me/adaccounts?fields=id,name,currency,account_id&limit=100&access_token=${encodeURIComponent(creds.accessToken)}`;
    while (url) {
      const page: z.infer<typeof accountsSchema> = await call(url, accountsSchema);
      out.push(...page.data.map((a) => ({ externalId: a.id, name: a.name, currency: a.currency })));
      url = page.paging?.next;
    }
    return out;
  },
  async fetchDailySpend(creds, externalId, start, end) {
    const p = new URLSearchParams({
      fields: "spend,impressions,clicks,account_currency,actions,action_values",
      time_increment: "1",
      time_range: JSON.stringify({ since: start, until: end }),
      level: "account",
      limit: "500",
      access_token: creds.accessToken,
    });
    const out: DailySpend[] = [];
    let url: string | undefined = `${GRAPH}/${externalId}/insights?${p}`;
    while (url) {
      const page: z.infer<typeof insightsSchema> = await call(url, insightsSchema);
      for (const row of page.data) {
        const currency = row.account_currency ?? "USD";
        const purchaseValue = row.action_values?.find((a) => a.action_type === "omni_purchase" || a.action_type === "purchase")?.value;
        const purchases = row.actions?.find((a) => a.action_type === "omni_purchase" || a.action_type === "purchase")?.value;
        out.push({
          date: row.date_start,
          currency,
          spendMinor: toMinor(row.spend ?? "0", currency),
          impressions: row.impressions ? Number(row.impressions) : null,
          clicks: row.clicks ? Number(row.clicks) : null,
          attributedRevenueMinor: purchaseValue ? toMinor(purchaseValue, currency) : null,
          attributedConversions: purchases ? Math.round(Number(purchases)) : null,
        });
      }
      url = page.paging?.next;
    }
    return out;
  },
};
