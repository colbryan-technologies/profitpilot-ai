import type { AdProvider } from "@prisma/client";

/**
 * Advertising provider abstraction.
 *
 * Providers return *spend* (money the merchant paid the platform), which feeds
 * profit calculations. Platform-reported *attributed* revenue/conversions are
 * returned separately and stored only as informational fields — they are never
 * substituted for spend or for Shopify revenue.
 */
export interface DailySpend {
  date: string; // YYYY-MM-DD in the ad account's timezone
  currency: string;
  spendMinor: number;
  impressions: number | null;
  clicks: number | null;
  attributedRevenueMinor: number | null;
  attributedConversions: number | null;
}

export interface AdAccountInfo {
  externalId: string;
  name: string;
  currency: string;
}

export interface ProviderCredentials {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  /** Provider-specific extras (e.g. Google login-customer-id). */
  extra?: Record<string, string>;
}

export interface AdsProvider {
  readonly key: AdProvider;
  /** Build the OAuth authorization URL for connecting an account. */
  authorizeUrl(state: string, redirectUri: string): string;
  /** Exchange the OAuth code for credentials. */
  exchangeCode(code: string, redirectUri: string): Promise<ProviderCredentials>;
  /** Refresh an expiring token if the provider supports it. */
  refresh(creds: ProviderCredentials): Promise<ProviderCredentials>;
  /** List ad accounts the credentials can read. */
  listAccounts(creds: ProviderCredentials): Promise<AdAccountInfo[]>;
  /** Daily spend for an ad account between two YYYY-MM-DD dates (inclusive). */
  fetchDailySpend(creds: ProviderCredentials, externalId: string, start: string, end: string): Promise<DailySpend[]>;
}

export class AdsProviderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly reauthRequired = false,
  ) {
    super(message);
  }
}
