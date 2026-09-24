# Paid feature enforcement checkpoint

Weekly briefing generation and enabling the weekly preference now require a verified plan with digest access. Background scheduler denials are skipped as expected, and the Reports and Preferences screens explain when an upgrade is required. Historical briefing records are retained but not returned by the Reports loader while access is unavailable.

The existing COGS CSV export service requires CSV export access. Customer privacy exports remain independent of billing. The COGS export service does not yet have a merchant download route.

Connected advertising account creation and reconnection use a tenant row lock to enforce the plan's account count under simultaneous requests. Only implemented Meta and Google providers can connect. Manual spend remains available and consumes no connected-account slot. Non-disconnected remote accounts count, including accounts awaiting reauthentication; disconnecting releases a slot.

Background ad synchronization rechecks the plan and processes only the oldest accounts within the current allowance, using creation time and ID for deterministic ordering. Excess accounts are paused by this check without deleting stored spend or credentials. Credential renewal follows the same allowance, including partial downgrades. Merchant account selection/disconnection controls and live advertising OAuth remain unfinished; users cannot yet choose which accounts retain slots. Previously stored spend remains part of calculations, and stale-spend warnings still need stronger coverage before launch.

No Shopify API query or pricing contract changed. Tests cover service denials, allowance concurrency, retained records after a downgrade, and continued credential renewal within a reduced allowance. Order/history limits remain pending: dropping excess orders during ingestion would make financial reports misleading. Complete-period reporting restrictions and explicit coverage indicators must precede any such restriction. No production deployment or App Store submission occurred.
