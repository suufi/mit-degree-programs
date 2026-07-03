import { config } from "dotenv";

config();

const DEFAULT_MODEL = "gemini-2.0-flash";

export type GeminiGenerateOptions = {
  model?: string;
  temperature?: number;
  responseJson?: boolean;
  timeoutMs?: number;
};

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
  error?: {
    message?: string;
    status?: string;
    details?: Array<{ "@type"?: string; retryDelay?: string }>;
  };
};

/** Error thrown for a failed Gemini HTTP call, carrying status + retry hints. */
export class GeminiError extends Error {
  readonly status?: number;
  readonly retryAfterMs?: number;
  private readonly retryableOverride?: boolean;

  constructor(
    message: string,
    options: { status?: number; retryAfterMs?: number; retryable?: boolean } = {},
  ) {
    super(message);
    this.name = "GeminiError";
    this.status = options.status;
    this.retryAfterMs = options.retryAfterMs;
    this.retryableOverride = options.retryable;
  }

  /** True for transient failures worth retrying (rate limit / server / network). */
  get isRetryable(): boolean {
    if (this.retryableOverride !== undefined) return this.retryableOverride;
    if (this.status === 429) return true;
    if (this.status !== undefined && this.status >= 500) return true;
    return /rate limit|resource_exhausted|quota|unavailable|overloaded/i.test(this.message);
  }
}

/** Parse a Google RetryInfo delay string like "27s" or "1.5s" into ms. */
function parseRetryDelay(payload: GeminiResponse): number | undefined {
  const detail = payload.error?.details?.find((entry) =>
    entry["@type"]?.includes("RetryInfo"),
  );
  const raw = detail?.retryDelay;
  if (!raw) return undefined;
  const match = raw.match(/([\d.]+)\s*s/i);
  return match ? Math.ceil(Number(match[1]) * 1000) : undefined;
}

export function getGeminiConfig(): { apiKey: string; model: string } | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return null;
  return {
    apiKey,
    model: process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL,
  };
}

export async function generateGeminiText(
  prompt: string,
  options?: GeminiGenerateOptions,
): Promise<string> {
  const config = getGeminiConfig();
  if (!config) {
    throw new Error("GEMINI_API_KEY is not set");
  }

  const model = options?.model ?? config.model;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(config.apiKey)}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options?.timeoutMs ?? 120000);

  let payload: GeminiResponse;
  let ok: boolean;
  let status: number;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: options?.temperature ?? 0.1,
          ...(options?.responseJson ? { responseMimeType: "application/json" } : {}),
        },
      }),
    });
    ok = response.ok;
    status = response.status;
    payload = (await response.json()) as GeminiResponse;
  } catch (error) {
    // Network errors and timeouts (AbortError) are transient — mark retryable.
    const message = error instanceof Error ? error.message : String(error);
    throw new GeminiError(`Gemini request failed: ${message}`, { retryable: true });
  } finally {
    clearTimeout(timeout);
  }

  if (!ok) {
    const message = payload.error?.message ?? `Gemini request failed (${status})`;
    throw new GeminiError(message, {
      status,
      retryAfterMs: parseRetryDelay(payload),
    });
  }

  const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
  if (!text.trim()) {
    throw new Error("Gemini returned empty content");
  }
  return text;
}

/** Parse Gemini output that may include fences or prose after valid JSON. */
export function extractJsonFromText(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = (fenced?.[1] ?? trimmed).trim();

  try {
    return JSON.parse(candidate);
  } catch {
    /* fall through — model often appends text after a valid JSON object */
  }

  const start = candidate.search(/[{[]/);
  if (start < 0) {
    throw new SyntaxError("No JSON object or array found in Gemini response");
  }

  return JSON.parse(extractBalancedJson(candidate, start));
}

function extractBalancedJson(text: string, start: number): string {
  const stack: string[] = [];
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") stack.push("}");
    else if (ch === "[") stack.push("]");
    else if (ch === "}" || ch === "]") {
      const expected = stack.pop();
      if (expected !== ch) {
        throw new SyntaxError("Mismatched JSON delimiters in Gemini response");
      }
      if (stack.length === 0) return text.slice(start, i + 1);
    }
  }

  throw new SyntaxError("Unterminated JSON in Gemini response");
}

export async function generateGeminiJson<T>(prompt: string, options?: GeminiGenerateOptions): Promise<T> {
  const text = await generateGeminiText(prompt, { ...options, responseJson: true });
  return extractJsonFromText(text) as T;
}

export type RetryOptions = {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  onRetry?: (info: { attempt: number; delayMs: number; error: GeminiError }) => void;
};

/**
 * Runs a Gemini call with exponential backoff on retryable failures (429 /
 * 5xx / quota). Honors the server's RetryInfo delay when provided.
 */
export async function withGeminiRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxRetries = options.maxRetries ?? 5;
  const baseDelayMs = options.baseDelayMs ?? 5000;
  const maxDelayMs = options.maxDelayMs ?? 60000;

  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const gemErr = error instanceof GeminiError ? error : undefined;
      if (!gemErr?.isRetryable || attempt >= maxRetries) throw error;
      const backoff = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
      // Free-tier quota errors often return a tiny (<1s) retry hint that does
      // not reflect the per-minute reset window, so never wait *less* than our
      // exponential backoff.
      const delayMs = Math.min(Math.max(gemErr.retryAfterMs ?? 0, backoff), maxDelayMs);
      options.onRetry?.({ attempt: attempt + 1, delayMs, error: gemErr });
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}
