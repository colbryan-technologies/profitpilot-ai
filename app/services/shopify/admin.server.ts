import { unauthenticated } from "../../shopify.server";
import { logger } from "../../lib/logger.server";

export class ShopifyGraphqlError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly errors: unknown,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

export interface AdminGraphql {
  <T>(query: string, variables?: Record<string, unknown>): Promise<T>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Background-job GraphQL client for a shop's offline session.
 * Handles Shopify's cost-based throttling (THROTTLED errors and 429s) with
 * backoff, and surfaces auth failures as non-retryable so the job can stop.
 */
export async function adminGraphqlForShop(shopDomain: string): Promise<AdminGraphql> {
  const { admin } = await unauthenticated.admin(shopDomain);
  const log = logger.child({ shopDomain });

  return async function graphql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    let attempt = 0;
    for (;;) {
      attempt++;
      let response: Response;
      try {
        response = await admin.graphql(query, { variables });
      } catch (err) {
        const status = (err as { response?: { status?: number } })?.response?.status ?? 0;
        if (status === 401 || status === 403 || status === 404) {
          throw new ShopifyGraphqlError(`Shopify auth error (${status})`, status, null, false);
        }
        if (status === 429 && attempt <= 6) {
          const wait = Math.min(30_000, 1_000 * 2 ** attempt);
          log.warn({ attempt, wait }, "shopify 429 — backing off");
          await sleep(wait);
          continue;
        }
        if (attempt <= 3) {
          await sleep(500 * attempt);
          continue;
        }
        throw new ShopifyGraphqlError(`Shopify request failed: ${(err as Error).message}`, status, null, true);
      }

      const body = (await response.json()) as { data?: T; errors?: Array<{ message: string; extensions?: { code?: string } }>; extensions?: { cost?: { throttleStatus?: { currentlyAvailable: number; restoreRate: number } } } };
      if (body.errors?.length) {
        const throttled = body.errors.some((e) => e.extensions?.code === "THROTTLED");
        if (throttled && attempt <= 8) {
          const ts = body.extensions?.cost?.throttleStatus;
          const wait = ts ? Math.min(20_000, Math.ceil((200 / Math.max(1, ts.restoreRate)) * 1000)) : 2_000 * attempt;
          log.warn({ attempt, wait }, "shopify throttled — waiting");
          await sleep(wait);
          continue;
        }
        throw new ShopifyGraphqlError(body.errors.map((e) => e.message).join("; "), response.status, body.errors, false);
      }
      if (!body.data) throw new ShopifyGraphqlError("Empty GraphQL response", response.status, null, true);
      return body.data;
    }
  };
}
