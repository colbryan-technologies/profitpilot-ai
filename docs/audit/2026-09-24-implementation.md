# Implementation checkpoint — 24 September 2026

This extends the preserved Devin baseline; it does not replace it. The original findings remain in [the baseline audit](2026-09-24-baseline.md). This is a development build, not a production release.

## Implemented in this checkpoint

- Build the web application and a separate background worker; use a non-root container and locked npm CI checks.
- Repair queue identifiers, retry delivery of stored jobs/webhooks, sequence initial synchronization, retain cancelled status, and recalculate historical orders after changes.
- Strip unnecessary customer fields from stored webhook payloads and clear processed payloads. Scrub store webhook/audit records during deletion.
- Reject mixed-currency calculations, correct advertising micros conversion, preserve shipping costs after returns, and cover additional tax cases.
- Validate nonnegative cost settings, strict dates, ambiguous COGS matching and CSV size limits.
- Default external AI processing to off per merchant; show deterministic fallback when validation rejects an answer. Respect active subscription status for AI allowances.
- Add authenticated merchant routes for overview, orders/details, products/details, COGS entry/import, expenses, manual advertising spend, leaks, questions, settings, notification preferences, reports, billing and data health. Data comes from existing tenant-scoped services; missing data and incomplete integrations are disclosed.

## Verification and limits

Local type checking, lint and web/worker production builds pass. Unit tests cover the existing finance/intelligence cases plus currency boundaries and webhook delivery failures. These do not exercise a real database, queue or installed Shopify app.

Shopify Admin query validation passed for the sampled orders query. The Polaris toolkit validator could not complete in its isolated environment (missing Preact JSX/runtime and project module resolution, after correcting its TypeScript dependency). Application TypeScript checks pass, but toolkit validation and rendered browser review remain outstanding.

Production dependency audit still reports four high-severity entries rooted in deepmerge-ts through Prisma. Compatible lodash/minimatch updates are applied. The separate Prisma major-upgrade branch has not been merged; its migration requirements must be evaluated before adoption.

Docker is installed but its local daemon is unavailable. PostgreSQL migrations, Redis recovery, tenant-isolation integration tests, container execution, browser/accessibility review, OAuth installation and billing still need live verification. No production deployment or App Store submission was performed.

## Release blockers / next work

1. Reconcile Shopify fixtures for order edits, gift-card liabilities, duties, manual refund adjustments and shipping-tax refunds; implement complete nested connection paging. Current calculation results are provisional until this is complete.
2. Implement customer data-request fulfillment, retention policy and deletion verification; add adversarial tenant-isolation tests and request rate limits.
3. Make AI quotas atomic and strengthen semantic grounding beyond numeric validation. Verify provider disclosure and cancellation behavior.
4. Verify hosted billing configuration and enforce every tier allowance at service boundaries. Do not onboard paying merchants yet.
5. Complete Meta/Google OAuth, timeouts and API-version review. Only manual advertising entry is currently exposed.
6. Exercise PostgreSQL/Redis, migration rollback/recovery, full synchronization, reinstall/uninstall and queue outage scenarios in a development environment.
7. Finish production environment enforcement, health/monitoring, money-column capacity review, backups, responsive/accessibility testing and inherited workflow cleanup.
8. Supply support/privacy contacts and review launch documents and all changes before production.

Required live inputs: a Shopify development app and store, configured callback URL, PostgreSQL and Redis services, and verified Shopify pricing handles. Configure credentials privately through environment management; never put them into repository files, issues or chat.

The recovered master brief was truncated after the start of section 37. Remaining original specification text still needs reconciliation before declaring full scope complete.
