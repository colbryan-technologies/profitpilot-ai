# Dependency and production startup checkpoint

The full npm dependency audit reports zero known vulnerabilities at this checkpoint, including development dependencies. The remaining deepmerge-ts advisory was resolved by pinning `8.0.2` specifically under `@prisma/config`, preserving Prisma 6 and its existing schema. A regression test loads a typed Prisma configuration through the real loader; CI also generates the client and deploys migrations. This override needs review when upgrading Prisma. A clean audit is not proof of complete application security.

Environment validation now runs whenever application configuration is first loaded. Production web and worker processes reject missing Shopify credentials, pricing credentials, database/Redis settings or encryption key; invalid database/Redis protocols; HTTP, loopback or example application URLs; malformed/zero encryption keys; placeholder app IDs; and enabled AI without a provider key. Errors list field names without including supplied values. Development/test defaults remain available outside production.

The environment parser does not verify remote credentials, database connectivity, TLS deployment configuration or Shopify pricing handles. Production now requires the Partner pricing settings even for a free-tier launch, preventing the deliberately unenforced development billing configuration from being used inadvertently. Merchant billing limits still need separate service-level enforcement.

CI runs a high-severity npm audit gate and starts both built entry points with deliberately incomplete production configuration, verifying that each fails promptly for the expected reason. These startup checks do not contact a live shop or deploy anything.

Sources: [upstream advisory](https://github.com/advisories/GHSA-ggr8-5vv4-36mx), [deepmerge-ts 8.0.0 changes](https://github.com/RebeccaStevens/deepmerge-ts/releases/tag/v8.0.0), [8.0.2 runtime requirement correction](https://github.com/RebeccaStevens/deepmerge-ts/releases/tag/v8.0.2).

Remaining launch blockers include live Shopify/Redis/browser acceptance, financial edge-case reconciliation, billing enforcement, rate limiting, key rotation and retention/remediation work documented in the earlier audits. No production deployment or App Store submission was performed.
