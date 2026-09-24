import { describe, expect, it, vi } from "vitest";
import { formData } from "../../app/services/form.server";

describe("merchant form body limits", () => {
  it("parses URL-encoded fields and unicode", async () => {
    expect(
      await formData(
        new Request("https://example.test", {
          method: "POST",
          body: new URLSearchParams({ name: "Café", amount: "12.30" }),
        }),
      ),
    ).toEqual({ name: "Café", amount: "12.30" });
  });
  it("rejects unsupported encodings", async () => {
    await expect(
      formData(
        new Request("https://example.test", {
          method: "POST",
          body: "{}",
          headers: { "content-type": "application/json" },
        }),
      ),
    ).rejects.toMatchObject({ status: 415 });
  });
  it("rejects oversize advertised bodies before reading them", async () => {
    await expect(
      formData(
        new Request("https://example.test", {
          method: "POST",
          body: "small",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            "content-length": "2000001",
          },
        }),
      ),
    ).rejects.toMatchObject({ status: 413 });
  });
  it("bounds chunked bodies despite a false content length and cancels the stream", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream({
      pull(controller) {
        controller.enqueue(new Uint8Array(1_000_001));
      },
      cancel,
    });
    const request = new Request("https://example.test", {
      method: "POST",
      body,
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "content-length": "1",
      },
      duplex: "half",
    } as RequestInit);
    await expect(formData(request)).rejects.toMatchObject({ status: 413 });
    expect(cancel).toHaveBeenCalledOnce();
  });
});
