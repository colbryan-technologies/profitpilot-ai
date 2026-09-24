import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("../../app/db.server", () => ({ default: {} }));
vi.mock("../../app/services/shopify/admin.server", () => ({
  adminGraphqlForShop: vi.fn(),
}));
vi.mock("../../app/services/shopify/persist.server", () => ({
  upsertOrder: vi.fn(),
  upsertProduct: vi.fn(),
}));
import { iterateBulkOrders } from "../../app/services/shopify/sync.server";

afterEach(() => vi.unstubAllGlobals());
async function collect() {
  const records = [];
  for await (const row of iterateBulkOrders("https://example.test/bulk"))
    records.push(row);
  return records;
}
describe("bulk order identity streaming", () => {
  it("handles records across chunks, blank lines and no trailing newline", async () => {
    const encoder = new TextEncoder();
    const chunks = [
      '{"id":"gid://shopify/Order/',
      '1"}\n\n{"id":"gid://shopify/Order/2"}',
    ];
    const stream = new ReadableStream({
      start(controller) {
        chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
        controller.close();
      },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(stream)));
    expect(await collect()).toEqual([
      { id: "gid://shopify/Order/1" },
      { id: "gid://shopify/Order/2" },
    ]);
  });
  it.each([
    '{"id":"gid://shopify/Product/1"}',
    '{"id":"gid://shopify/Order/1","__parentId":"other"}',
    '{"unexpected":true}',
    "invalid",
  ])(
    "rejects unexpected data instead of silently completing: %s",
    async (body) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body)));
      await expect(collect()).rejects.toThrow();
    },
  );
  it("surfaces failed downloads", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("", { status: 503 })),
    );
    await expect(collect()).rejects.toThrow("Bulk download failed (503)");
  });
});
