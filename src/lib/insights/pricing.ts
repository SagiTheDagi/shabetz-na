/**
 * Claude Haiku 5.5 pricing, USD per token. Two tiers by the request's total
 * input (uncached + cache write + cache read): ≤100K tokens and above.
 * Update these constants if Anthropic changes Haiku 5.5 pricing.
 */
export const INSIGHTS_MODEL = "claude-haiku-5-5";

export const PRICE_TIERS = {
  standard: { input: 0.10 / 1e6, output: 0.50 / 1e6 },
  long: { input: 0.50 / 1e6, output: 2.50 / 1e6 },
} as const;

export const LONG_CONTEXT_THRESHOLD = 100_000;
export const CACHE_WRITE_MULTIPLIER = 1.25;
export const CACHE_READ_MULTIPLIER = 0.1;

export interface TokenUsage {
  input_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  /** Includes thinking tokens. */
  output_tokens: number;
}

export function tierFor(totalInputTokens: number) {
  return totalInputTokens > LONG_CONTEXT_THRESHOLD ? PRICE_TIERS.long : PRICE_TIERS.standard;
}

/** Cost of one model call. */
export function computeCost(usage: TokenUsage): number {
  const input = usage.input_tokens;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const p = tierFor(input + cacheWrite + cacheRead);
  return (
    input * p.input +
    cacheWrite * p.input * CACHE_WRITE_MULTIPLIER +
    cacheRead * p.input * CACHE_READ_MULTIPLIER +
    usage.output_tokens * p.output
  );
}

/**
 * Pessimistic token count for text: ASCII at 3 chars per token, every other
 * char (Hebrew) as a full token. Hebrew needs far more tokens per char than
 * English, so a flat chars ÷ 3 would undercount Hebrew several-fold.
 */
export function estimateTextTokens(text: string): number {
  let nonAscii = 0;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) > 127) nonAscii++;
  return Math.ceil((text.length - nonAscii) / 3) + nonAscii;
}

/** Pessimistic pre-call estimate: estimated input tokens, max_tokens as output. */
export function estimateCost(inputTokens: number, maxTokens: number): number {
  const p = tierFor(inputTokens);
  return inputTokens * p.input + maxTokens * p.output;
}
