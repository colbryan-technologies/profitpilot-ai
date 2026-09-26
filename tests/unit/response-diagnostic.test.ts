import { expect, it } from "vitest";
import {
  documentFailureSource,
  responseFailureSource,
  RESPONSE_DIAGNOSTIC_HEADER,
} from "../../app/lib/response-diagnostic";

it("recognizes the rate limiter's thrown response after router error conversion", () => {
  expect(
    documentFailureSource({
      root: {
        status: 503,
        data: "Request protection is temporarily unavailable. Please try again shortly.",
      },
    }),
  ).toBe("redis_rate_limit");
});

it("does not misclassify arbitrary server errors as Redis failures", () => {
  expect(
    documentFailureSource({ root: new Error("redis://user:secret@host") }),
  ).toBe("app_response");
  expect(documentFailureSource(null)).toBe("app_response");
});

it("does not pass arbitrary response header contents into logs", () => {
  const headers = new Headers({
    [RESPONSE_DIAGNOSTIC_HEADER]: "https://private/?token=secret",
  });
  expect(responseFailureSource(headers)).toBe("unclassified_response");
  expect(responseFailureSource(new Headers())).toBe("unclassified_response");
});
