import { describe, it, expect } from "vitest";
import { currentConversationHistory } from "../../app/services/ai/history";
const data = {
  calcVersion: "current",
  period: { start: "2026-09-01", end: "2026-09-08" },
  metrics: { profit: 100 },
};
const pair = (groundingJson: unknown) => [
  { role: "USER", content: "What changed?" },
  { role: "ASSISTANT", content: "Profit was 100", groundingJson },
];
describe("current-only AI conversation context", () => {
  it("retains complete pairs with matching figures regardless of JSON key order", () =>
    expect(
      currentConversationHistory(
        pair({
          metrics: { profit: 100 },
          period: { end: "2026-09-08", start: "2026-09-01" },
          calcVersion: "current",
        }),
        data,
      ),
    ).toHaveLength(2));
  it("drops prior answers when recalculated figures change", () =>
    expect(
      currentConversationHistory(
        pair({ ...data, metrics: { profit: 99 } }),
        data,
      ),
    ).toEqual([]));
  it("drops answers for a different period or calculation version", () => {
    expect(
      currentConversationHistory(
        pair({ ...data, period: { start: "2026-08-01", end: "2026-08-08" } }),
        data,
      ),
    ).toEqual([]);
    expect(
      currentConversationHistory(pair({ ...data, calcVersion: "old" }), data),
    ).toEqual([]);
  });
  it("drops ungrounded legacy answers and unpaired questions", () =>
    expect(
      currentConversationHistory(
        [...pair(null), { role: "USER", content: "Old unmatched question" }],
        data,
      ),
    ).toEqual([]));
  it("retains only the current pair in mixed history", () =>
    expect(
      currentConversationHistory(
        [...pair({ metrics: { profit: 9 } }), ...pair(data)],
        data,
      ),
    ).toHaveLength(2));
});
