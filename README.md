# ProfitPilot AI

Embedded Shopify profitability app by COLBRYAN Technologies. This repository preserves Devin's original implementation and continues it on `codex/audit-and-hardening`.

**Development checkpoint: not approved for paying merchants or production.** Read [the baseline audit](docs/audit/2026-09-24-baseline.md) and [implementation status and blockers](docs/audit/2026-09-24-implementation.md).

## Architecture

- React Router and Shopify App Bridge for the authenticated merchant application.
- PostgreSQL with Prisma migrations for tenant-scoped commerce data, costs, snapshots and audit history.
- Redis/BullMQ and a separate worker for ingestion, recalculation, leaks and weekly briefings.
- Deterministic integer-minor-unit financial calculations. Optional external AI summarizes grounded data; it does not calculate profit.

## Local development

Use Node 24, PostgreSQL and Redis. Copy `.env.example` to an ignored `.env` and configure credentials privately. Configure a Shopify development app/store and callback URLs using Shopify CLI. The checked-in app configuration still contains placeholders.

```sh
npm ci --ignore-scripts
npx prisma generate
npx prisma migrate deploy
npm run dev
```

Start the worker separately with the same private environment:

```sh
npm run worker:dev
```

A running web process alone does not synchronize data. Merchant onboarding and Data health show synchronization status. External AI is off by default and requires both provider configuration and merchant consent. Advertising OAuth is not exposed yet; manual daily spend entry is available.

## Validation

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm run check:release
```

The offline release check validates privately supplied production settings and built entry points; it does not connect to services or deploy. See [live validation handoff](docs/audit/2026-09-24-live-validation.md) for the remaining setup and acceptance evidence.

The build produces `build/server/index.js` and `build/worker/index.js`. Run these with `npm start` and `npm run worker` as separate processes. Apply database migrations once as a release step before starting either process. Back up the database first; schema rollback is not automatic.

## Review boundary

The preserved baseline is tagged `checkpoint/devin-2026-09-24`. Continue in review branches. Never commit `.env`, credentials, database exports or merchant payloads. Do not deploy to production or submit to the Shopify App Store before owner review of the release blockers and live acceptance evidence.
