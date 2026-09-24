# Complete ingestion and database validation checkpoint

Extends the earlier [implementation checkpoint](2026-09-24-implementation.md).

## Changes

- Page through every order line, refund line, refunded shipping line and product variant. Mappers require explicit completion metadata. Missing metadata, stalled cursors, deleted records and changing parent versions fail the import before that record is persisted.
- Discover order/product IDs in outer pages, then fetch each record separately to avoid multiplying nested connection cost across 50 parents. Read the transaction list without its previous `first: 50` truncation.
- Bulk operations now export order IDs and re-fetch each through the same complete ingestion path. This is slower than a full bulk payload, but avoids the unverified flattened refund reassembly. Do not adopt an unrelated running bulk job. Unexpected bulk records fail visibly.
- Include shipping refund tax in persisted refund totals; correctly calculate remaining shipping revenue under inclusive/exclusive prices and both configured tax treatments. Calculation version is now `2026.09.3`.
- Add PostgreSQL to CI, deploy all migrations to an isolated database, and test tenant-scoped persistence, customer redaction and store deletion with synthetic records. Local database tests remain opt-in: `RUN_INTEGRATION_TESTS=1` and a loopback `profitpilot_test` database are required.
- Remove seven upstream template workflows for Shopify CLA, Slack/gardener automation, issue housekeeping and JavaScript branch conversion. Retain the application's validation workflow.

## Upgrade and verification

Existing stores need a full historical order/product re-sync followed by recalculation. Recalculation alone cannot recover omitted records or previously unrecorded shipping refund taxes. This checkpoint has not performed a live merchant re-sync.

Ten GraphQL documents pass the Shopify AI Toolkit validator against the configured `2025-10` schema. Unit tests cover connection paging, refund paging, parent changes, invalid cursors, bulk streaming and tax cases. CI exercises real PostgreSQL migrations and persistence; see the branch's Actions run for its actual result.

Live Shopify cost/throttle behavior, large-store performance, Redis recovery and full merchant browser journeys remain unverified. Gift-card liability treatment, duties, order edits, manual refund adjustments, privacy request fulfillment, rate limits, billing enforcement and the dependency advisory remain release blockers. This is not approval to deploy or charge merchants.

Sources: [Order API and transaction truncation](https://shopify.dev/docs/api/admin-graphql/2025-10/objects/Order), [shipping refund tax fields](https://shopify.dev/docs/api/admin-graphql/2025-10/objects/RefundShippingLine).
