/** Return only fixed labels; exception messages can contain credentials or URLs. */
export function failureCategory(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (/abort|cancel/.test(message)) return "aborted";
  if (/timeout|timed out/.test(message)) return "timeout";
  if (/not listening|port/.test(message)) return "port_unavailable";
  if (/econnrefused|econnreset|connection.*closed|socket/.test(message))
    return "connection_unavailable";
  if (/noauth|wrongpass|authentication/.test(message)) return "authentication";
  return "unknown";
}
