# History access and monthly order visibility

Report services now reject periods outside the verified plan's history window as a whole. No dates are silently cut from a requested total. Order lists and detail access use local-day boundaries converted to instants in PostgreSQL, including daylight-saving changes. Upgrade/downgrade applies on the next entitlement refresh; stored records, ingestion and recalculation are retained.

AI grounding no longer reads prior-period summaries outside history. Such deltas are explicitly unavailable with no percentage or cost-driver comparison, rather than represented as zero profit. Stored leaks and briefings are filtered with a seven-day comparison buffer, matching their current weekly generation period. Older stored conversation messages are not exposed through the current UI; any future conversation retrieval route must enforce history policy too. The Ask service can accept an internal conversation ID, so historical conversation-context retention remains a launch blocker.

Monthly order limits keep the repository's existing soft-limit policy: Billing and Overview show recorded non-test order usage for the store-local calendar month and an upgrade notice above the allowance. Counts are based on stored processed dates, include cancelled non-test orders, may lag Shopify, and are not a Shopify billing meter. No charges, automatic upgrades, partial ingestion or silent report truncation occur. The owner's choice on hard blocking versus notices was requested; absent an answer, the existing soft-limit behavior is preserved.

History enforcement is an access policy, not proof of source completeness. Initial sync coverage, stale snapshots, historical recalculation and data-health acceptance still need verification. No production deployment or App Store submission occurred.

Timezone conversion follows [PostgreSQL date/time semantics](https://www.postgresql.org/docs/16/functions-datetime.html#FUNCTIONS-DATETIME-ZONECONVERT). Tests cover local calendar boundaries, daylight saving, whole-period rejection, upgrade/downgrade and unavailable AI comparisons.
