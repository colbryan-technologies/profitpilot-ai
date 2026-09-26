// Only fixed labels cross the container boundary. Never include error contents,
// request URLs, credentials, or tenant identifiers in the diagnostic header.
export const RESPONSE_DIAGNOSTIC_HEADER = "X-ProfitPilot-Response-Source";

export function documentFailureSource(errors: Record<string, unknown> | null) {
  for (const error of Object.values(errors ?? {})) {
    if (!error || typeof error !== "object" || !("data" in error)) continue;
    const data = error.data;
    if (
      data ===
        "Request protection is temporarily unavailable. Please try again shortly." ||
      data === "Request protection is temporarily unavailable."
    )
      return "redis_rate_limit";
    if (
      typeof data === "string" &&
      data.startsWith("Report data is not ready. ")
    )
      return "report_readiness";
  }
  return "app_response";
}

export function responseFailureSource(headers: Headers) {
  const source = headers.get(RESPONSE_DIAGNOSTIC_HEADER);
  return source === "redis_rate_limit" ||
    source === "report_readiness" ||
    source === "app_response"
    ? source
    : "unclassified_response";
}
