import type { ChatMessage } from "./provider.server";
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
/** Carry forward only complete question/answer pairs grounded in the current report. */
export function currentConversationHistory(
  messages: Array<{ role: string; content: string; groundingJson?: unknown }>,
  currentData: unknown,
): ChatMessage[] {
  const expected = canonical(currentData);
  const result: ChatMessage[] = [];
  let question: string | null = null;
  for (const message of messages) {
    if (message.role === "USER") question = message.content;
    else if (message.role === "ASSISTANT") {
      if (
        question !== null &&
        message.groundingJson &&
        canonical(message.groundingJson) === expected
      )
        result.push(
          { role: "user", content: question },
          { role: "assistant", content: message.content },
        );
      question = null;
    }
  }
  return result;
}
