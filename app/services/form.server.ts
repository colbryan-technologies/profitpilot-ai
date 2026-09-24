import { data } from "react-router";
import { ZodError } from "zod";
import { logger } from "../lib/logger.server";

export async function formData(request: Request) {
  const body = await request.text();
  if (body.length > 2_000_000)
    throw new Response("Form too large", { status: 413 });
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
        { status: err.status },
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
      { status: 503 },
    );
  }
}
