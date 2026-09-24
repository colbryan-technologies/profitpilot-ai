import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionFunctionArgs } from "react-router";
const mocks = vi.hoisted(() => ({
  tenant: vi.fn(),
  require: vi.fn(),
  page: vi.fn(),
}));
vi.mock("../../app/services/tenant.server", () => ({ tenant: mocks.tenant }));
vi.mock("../../app/services/privacy.server", () => ({
  requirePrivacyRequest: mocks.require,
  privacyExportPage: mocks.page,
}));
import { action } from "../../app/routes/app.privacy_.$id.export";

const args = () =>
  ({
    request: new Request("https://example.test/app/privacy/request-1/export", {
      method: "POST",
    }),
    params: { id: "request-1" },
    url: new URL("https://example.test/app/privacy/request-1/export"),
    pattern: "/app/privacy/:id/export",
    context: {},
  }) as ActionFunctionArgs;
describe("private export response", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.tenant.mockResolvedValue({ store: { id: "authenticated-store" } });
    mocks.require.mockResolvedValue({ id: "request-1", requestId: "123" });
  });
  it("streams all pages with a completion marker and prevents caching", async () => {
    mocks.page
      .mockResolvedValueOnce({ orders: [{ id: "a" }], nextCursor: "a" })
      .mockResolvedValueOnce({ orders: [{ id: "b" }], nextCursor: null });
    const response = await action(args());
    const lines = (await response.text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(lines.map((line) => line.type)).toEqual([
      "manifest",
      "order",
      "order",
      "end",
    ]);
    expect(lines.at(-1)).toEqual({ type: "end", complete: true });
    expect(response.headers.get("cache-control")).toBe("no-store, private");
    expect(response.headers.get("content-disposition")).toContain("attachment");
    expect(mocks.require).toHaveBeenCalledWith(
      "authenticated-store",
      "request-1",
    );
    expect(mocks.page).toHaveBeenNthCalledWith(
      2,
      "authenticated-store",
      "request-1",
      "a",
    );
  });
  it("rejects unauthenticated requests before resolving a requested record", async () => {
    mocks.tenant.mockRejectedValue(
      new Response("Unauthorized", { status: 401 }),
    );
    await expect(action(args())).rejects.toMatchObject({ status: 401 });
    expect(mocks.require).not.toHaveBeenCalled();
    expect(mocks.page).not.toHaveBeenCalled();
  });
  it("fails the download if a later page cannot be authorized or read", async () => {
    mocks.page
      .mockResolvedValueOnce({ orders: [{ id: "a" }], nextCursor: "a" })
      .mockRejectedValueOnce(new Response("Not found", { status: 404 }));
    const response = await action(args());
    await expect(response.text()).rejects.toThrow("Export interrupted");
  });
});
