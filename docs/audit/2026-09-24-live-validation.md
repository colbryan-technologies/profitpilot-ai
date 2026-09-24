# Live validation handoff

Owner approved checkpoint 2399fbf for continued work. This does not supply the deployment destination or demonstrate live acceptance.

## Current blockers

The repository's Shopify app client ID is blank and its application/callback URLs are placeholders. No local private environment is configured. A development store address, selected hosting service, and authenticated access to the correct app are needed before live setup. Credentials must be entered through private environment settings, never in chat or committed files.

## Offline preflight

From a development checkout with dependencies installed, supply private environment variables using your environment manager and run `npm run check:release`. The command validates production settings even if NODE_ENV was development and checks for both built entry points. It prints field names only, never values. It does not load a .env file automatically, contact services, modify Shopify configuration, apply migrations or deploy. It is checkout tooling, not a command available in the pruned runtime image.

## Evidence still required

- Install and authenticate on the selected development store; confirm tenant isolation and reinstall behavior.
- Run web and worker with the same private environment; demonstrate completed import and recalculation, queue recovery and webhook processing.
- Reconcile orders, refunds, discounts, tax, shipping, costs and currency rounding against known store fixtures before trusting profit reports.
- Exercise reports, archived refresh, AI opt-in, plan restrictions and test billing without charging a merchant.
- Exercise privacy export/redaction and uninstall with synthetic records; verify deletion, retention and backup procedures.
- Verify TLS, protected health endpoints, database backups and restore, migrations and process restart on the selected host.

Keep test evidence free of customer payloads and credentials. Review unresolved audit findings before enabling paying merchants. Shopify configuration publication and hosting the web/worker are separate release steps; neither has been performed here.
