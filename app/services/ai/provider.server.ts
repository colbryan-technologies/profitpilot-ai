import { z } from "zod";
import { env } from "../../lib/env.server";
import { logger } from "../../lib/logger.server";

/**
 * LLM provider abstraction. The model only ever receives already-computed,
 * aggregated figures (see grounding.server.ts) and is asked to *explain* them.
 * It never receives raw customer data and its output never feeds a calculation.
 */
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CompletionResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
  provider: string;
  latencyMs: number;
}

export interface CompletionOptions {
  maxOutputTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  /** "fast" for chat, "strong" for weekly digests. */
  tier?: "fast" | "strong";
}

export class AiUnavailableError extends Error {}

const openaiSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }) })),
  usage: z.object({ prompt_tokens: z.number(), completion_tokens: z.number() }).optional(),
  model: z.string().optional(),
});
const anthropicSchema = z.object({
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
  usage: z.object({ input_tokens: z.number(), output_tokens: z.number() }),
  model: z.string().optional(),
});

function modelFor(tier: "fast" | "strong"): string {
  return tier === "strong" ? env().AI_MODEL_STRONG : env().AI_MODEL_FAST;
}

async function withTimeoutAndRetry<T>(fn: (signal: AbortSignal) => Promise<T>, timeoutMs: number, attempts = 2): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      return await fn(ctl.signal);
    } catch (err) {
      lastErr = err;
      const status = (err as { status?: number }).status;
      if (status && status < 500 && status !== 429) break;
    } finally {
      clearTimeout(t);
    }
  }
  throw lastErr;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function complete(messages: ChatMessage[], opts: CompletionOptions = {}): Promise<CompletionResult> {
  const cfg = env();
  if (cfg.AI_PROVIDER === "none" || !cfg.AI_API_KEY) throw new AiUnavailableError("AI provider not configured");
  const tier = opts.tier ?? "fast";
  const model = modelFor(tier);
  const timeoutMs = opts.timeoutMs ?? cfg.AI_TIMEOUT_MS;
  const maxTokens = opts.maxOutputTokens ?? 700;
  const temperature = opts.temperature ?? 0.2;
  const started = Date.now();

  if (cfg.AI_PROVIDER === "openai") {
    const body = await withTimeoutAndRetry(async (signal) => {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        signal,
        headers: { Authorization: `Bearer ${cfg.AI_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature }),
      });
      if (!res.ok) throw new HttpError(res.status, `OpenAI ${res.status}`);
      return openaiSchema.parse(await res.json());
    }, timeoutMs);
    return {
      text: body.choices[0]?.message.content ?? "",
      inputTokens: body.usage?.prompt_tokens ?? 0,
      outputTokens: body.usage?.completion_tokens ?? 0,
      model: body.model ?? model,
      provider: "openai",
      latencyMs: Date.now() - started,
    };
  }

  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const rest = messages.filter((m) => m.role !== "system");
  const body = await withTimeoutAndRetry(async (signal) => {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal,
      headers: { "x-api-key": cfg.AI_API_KEY, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({ model, system, messages: rest, max_tokens: maxTokens, temperature }),
    });
    if (!res.ok) throw new HttpError(res.status, `Anthropic ${res.status}`);
    return anthropicSchema.parse(await res.json());
  }, timeoutMs);
  return {
    text: body.content.map((c) => c.text ?? "").join(""),
    inputTokens: body.usage.input_tokens,
    outputTokens: body.usage.output_tokens,
    model: body.model ?? model,
    provider: "anthropic",
    latencyMs: Date.now() - started,
  };
}

/** Rough USD micro-dollar cost estimate for budgeting/alerts (not billing). */
export function estimateCostMicros(provider: string, model: string, inputTokens: number, outputTokens: number): number {
  const perM: Record<string, [number, number]> = {
    "gpt-4o-mini": [0.15, 0.6],
    "gpt-4o": [2.5, 10],
    "gpt-4.1-mini": [0.4, 1.6],
    "gpt-4.1": [2, 8],
    "claude-3-5-haiku": [0.8, 4],
    "claude-3-5-sonnet": [3, 15],
    "claude-sonnet-4": [3, 15],
  };
  const key = Object.keys(perM).find((k) => model.startsWith(k));
  const [inP, outP] = key ? perM[key] : [1, 4];
  const usd = (inputTokens / 1e6) * inP + (outputTokens / 1e6) * outP;
  if (!key) logger.debug({ provider, model }, "unknown model pricing; using default");
  return Math.round(usd * 1e6);
}
