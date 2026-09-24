# Archived briefing refresh

The Reports page offers Refresh this briefing for a withheld saved briefing. The server looks up its ID using the authenticated store and WEEKLY kind, returning 404 for missing or other-store IDs. Saved date boundaries are retained; custom grounding receives the inclusive last date derived from the stored exclusive end. Current-week generation also pins its grounding to the period chosen at the start of the operation, avoiding a midnight date shift.

Current plan feature/history checks and source readiness precede generation. The shared briefing limit applies to archived and current refreshes together. Fresh saved content is reused without consuming a generation slot. Seven-day, midnight-aligned periods are required; unsupported legacy ranges return a controlled error. Existing identity and date range are preserved on successful replacement. Failed readiness checks do not overwrite saved content. The model is explicitly asked for the period in DATA rather than this week.

Validation: six unit cases cover original dates, tenant isolation, plan downgrade/history rejection, unavailable sources, cache reuse and malformed ranges. Local typecheck, tests and production build pass. CI runs PostgreSQL and Redis integration checks as well. No live merchant browser acceptance or deployment performed.

Limitations: the existing Reports view displays at most 30 briefings within plan history, including the comparison window. Saved-briefing freshness remains conservative: unavailable comparison data or recalculation during generation can leave a refreshed briefing withheld. Refresh replaces generated content; it is not an immutable revision archive. The existing five-minute attempt limit is not a lock for work exceeding that window.
