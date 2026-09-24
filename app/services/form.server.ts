import { data } from "react-router";
import { ZodError } from "zod";
import { logger } from "../lib/logger.server";

export async function formData(request: Request) {
  const limit = 2_000_000;
  if (
    request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !==
    "application/x-www-form-urlencoded"
  )
    throw new Response("Unsupported form encoding", { status: 415 });
  if (Number(request.headers.get("content-length")) > limit)
    throw new Response("Form too large", { status: 413 });
  if (!request.body) return {};
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let body = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) throw new Response("Form too large", { status: 413 });
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  return Object.fromEntries(new URLSearchParams(body));
}
export async function formResult(work: () => Promise<string>) {
  try {
    return data({ message: await work(), error: undefined });
  } catch (err) {
    if (err instanceof ZodError)
      return data(
        {
          error: err.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; "),
          message: undefined,
        },
        { status: 400 },
      );
    if (err instanceof Response && err.status >= 400 && err.status < 500)
      return data(
        { error: await err.text(), message: undefined },
        { status: err.status, headers: err.headers },
      );
    logger.error(
      { errorType: err instanceof Error ? err.name : "unknown" },
      "merchant operation failed",
    );
    return data(
      {
        error:
          "The operation could not finish. Check data health before retrying; a saved change may still be waiting for recalculation.",
        message: undefined,
      },
      {
        status: 503,
        headers: {
          "Cache-Control": "no-store",
          ...(err instanceof Response && err.headers.has("Retry-After")
            ? { "Retry-After": err.headers.get("Retry-After")! }
            : {}),
        },
      },
    );
  }
}
