type Rate = { input: number; output: number; cacheRead: number; cacheWrite: number };

/** USD per 1M tokens. An estimate card, not Cursor's invoice. */
const RATES: Record<string, Rate> = {
  "composer-2": { input: 1.25, output: 6, cacheRead: 0.25, cacheWrite: 1.25 },
  "composer-2.5": { input: 1.25, output: 6, cacheRead: 0.25, cacheWrite: 1.25 },
  "gpt-4o": { input: 2.5, output: 10, cacheRead: 1.25, cacheWrite: 2.5 },
  "gpt-4o-mini": { input: 0.15, output: 0.6, cacheRead: 0.075, cacheWrite: 0.15 },
  default: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
};

export function estimateCostMicros(input: {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}): number {
  const rate = RATES[input.model] ?? RATES.default;
  const usd =
    (input.inputTokens * rate.input +
      input.outputTokens * rate.output +
      (input.cacheReadTokens ?? 0) * rate.cacheRead +
      (input.cacheWriteTokens ?? 0) * rate.cacheWrite) /
    1_000_000;
  return Math.round(usd * 1_000_000);
}
