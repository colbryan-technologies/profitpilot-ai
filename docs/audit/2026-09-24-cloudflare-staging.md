# Cloudflare staging configuration

The existing Dockerfile is reused by two Cloudflare Containers: one web instance and one BullMQ job instance. The routing Worker forwards HTTP requests to the web container only. A five-minute Cron Trigger starts or renews activity for the fixed job container. Both idle timers are ten minutes. This is staging scaffolding, not evidence of live acceptance or uninterrupted worker availability. Cron delays, instance termination and deployments can interrupt jobs; exercise recovery before release. A job container start does not prove database/Redis readiness or healthy job processing.

The checked-in name is profitpilot-ai-staging, with workers.dev enabled and no custom domain. The URL's account suffix is assigned by Cloudflare; no real URL has been provisioned. One instance per service bounds instance count, not total cost. The scheduled job service is intended to stay active and incurs usage charges. PostgreSQL and Redis must be hosted separately with TLS, backups and a Redis configuration suitable for BullMQ (including noeviction); container local disks are not the database.

## Private configuration and deployment sequence

1. Authenticate Wrangler to the selected Cloudflare account and record its account ID privately. Do not replace existing unrelated Workers.
2. Provision staging PostgreSQL and Redis, configure access, and apply Prisma migrations once from a controlled release environment. Neither database is created by this configuration.
3. Set the required Worker secrets listed in deploy/cloudflare/environment.ts, using Wrangler secret put with --config deploy/cloudflare/wrangler.json or the account's private settings. Supply optional settings through the same mechanism. Do not place credentials in wrangler.json, image build arguments, GitHub source or chat. Both containers receive the same allowlisted runtime settings.
4. Set the actual HTTPS application URL and link the existing Shopify development app configuration separately. The current Shopify TOML still has placeholders.
5. Run npm run cloudflare:check for a Docker image build and Worker bundle dry run. Docker is required. With Docker unavailable, adding -- --containers-rollout=none validates only the Worker bundle/configuration, not the image.
6. Once private setup and live-test prerequisites are ready, deploy using wrangler deploy --config deploy/cloudflare/wrangler.json. This is a billable remote action, not part of CI. Verify web authentication and worker processing, then follow the live validation handoff.

NODE_ENV is fixed to production so both processes enforce required configuration. BILLING_TEST_MODE is fixed to true for this staging deployment. AI defaults to none. Unrelated bindings and secrets are never forwarded. Wrapper errors return a generic 503; configuration errors list field names only. Secret rotation requires replacing/restarting running containers and checking their health; running process environments are not updated automatically by changing a secret.

## Validation and limitations

Local typecheck includes a separate Cloudflare TypeScript configuration. Credential-forwarding tests cover the allowlist, fixed staging settings and redacted missing-setting errors. Local Docker daemon is unavailable, so full image validation is delegated to the GitHub dry-run check. No Cloudflare resources, databases, remote secrets, Shopify configuration changes or deployments were created in this checkpoint. Live startup, restart recovery, external connectivity and merchant acceptance remain unverified.

References: https://developers.cloudflare.com/containers/reference/container-class/ and https://developers.cloudflare.com/containers/examples/env-vars-and-secrets/
