import { expect, it } from "vitest";
import { failureCategory } from "../../app/lib/failure-category";

it.each([
  ["timed out connecting to rediss://user:secret@example.test", "timeout"],
  ["port 3000 not listening", "port_unavailable"],
  ["ECONNRESET", "connection_unavailable"],
  ["WRONGPASS secret", "authentication"],
  ["request aborted", "aborted"],
  ["https://example.test/?id_token=secret", "unknown"],
])("classifies errors without returning their contents", (message, expected) => {
  expect(failureCategory(new Error(message))).toBe(expected);
});

it("does not serialize arbitrary thrown objects", () => {
  expect(failureCategory({ password: "secret" })).toBe("unknown");
});
