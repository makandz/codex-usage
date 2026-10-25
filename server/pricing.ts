export type TokenUsage = {
  input: number;
  cached: number;
  write: number;
  output: number;
};

export type Price = {
  inputCost: number;
  cachedCost: number;
  outputCost: number;
  savings: number;
};

// Base API rates per million tokens, verified 2026-10-25. No long-context uplift.
// https://developers.openai.com/api/docs/models/gpt-6.1-sol
// https://developers.openai.com/api/docs/pricing
// Keep unknown models unpriced instead of silently substituting a different model.
const rates: Record<string, { input: number; cached: number; write: number; output: number }> = {
  'gpt-6.1-sol': { input: 2, cached: 0.1, write: 2.5, output: 10 },
  'gpt-6-astra': { input: 10, cached: 1, write: 12.5, output: 50 },
  'gpt-6-luna': { input: 0.1, cached: 0.01, write: 0.125, output: 0.5 },
};

export const PRICING_VERSION = '2026-10-25-v3';

const tierMultipliers: Record<string, number> = {
  default: 1,
  standard: 1,
  priority: 2,
  fast: 2,
  ultrafast: 6,
  flex: 0.5,
  batch: 0.5,
};

/**
 * Estimate base API cost without a long-context uplift.
 * @param model Recorded model name; unknown models remain unpriced.
 * @param tier Recorded speed tier, or null to assume Standard.
 * @param usage Token counters with cached input included in input.
 * @returns USD costs and cache savings, or null when pricing is unknown.
 */
export function priceUsage(model: string, tier: string | null, usage: TokenUsage): Price | null {
  // User-confirmed free usage for this personal dashboard.
  if (model === 'codex-auto-review') {
    return { inputCost: 0, cachedCost: 0, outputCost: 0, savings: 0 };
  }
  const rate = rates[model];
  // Logs don't specify the cache-write TTL needed to choose a rate.
  if (!rate || usage.write > 0) {
    return null;
  }
  const speed = tier === null ? 1 : tierMultipliers[tier];
  if (typeof speed !== 'number') {
    return null;
  }
  const multiplier = speed / 1_000_000;
  return {
    inputCost: (usage.input - usage.cached) * rate.input * multiplier,
    cachedCost: usage.cached * rate.cached * multiplier,
    outputCost: usage.output * rate.output * multiplier,
    savings: usage.cached * (rate.input - rate.cached) * multiplier,
  };
}
