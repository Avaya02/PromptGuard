/**
 * Published per-token pricing, USD per 1M tokens.
 *
 * Used only for the `estimatedCostUsd` display field, so approximate figures
 * are acceptable — but they drift, so treat these as indicative, not billing
 * truth. Keys are matched by longest prefix so dated model ids resolve.
 */
export interface TokenPrice {
  inputPerMillion: number;
  outputPerMillion: number;
}

const PRICING: Record<string, TokenPrice> = {
  // OpenAI
  "gpt-4o-mini": { inputPerMillion: 0.15, outputPerMillion: 0.6 },
  "gpt-4o": { inputPerMillion: 2.5, outputPerMillion: 10 },
  "gpt-4.1-mini": { inputPerMillion: 0.4, outputPerMillion: 1.6 },
  "gpt-4.1": { inputPerMillion: 2, outputPerMillion: 8 },

  // Anthropic
  "claude-3-5-haiku": { inputPerMillion: 0.8, outputPerMillion: 4 },
  "claude-3-5-sonnet": { inputPerMillion: 3, outputPerMillion: 15 },
  "claude-sonnet-4": { inputPerMillion: 3, outputPerMillion: 15 },

  // Google
  "gemini-1.5-flash": { inputPerMillion: 0.075, outputPerMillion: 0.3 },
  "gemini-1.5-pro": { inputPerMillion: 1.25, outputPerMillion: 5 },
  "gemini-2.0-flash": { inputPerMillion: 0.1, outputPerMillion: 0.4 },

  // Groq
  "llama3-8b-8192": { inputPerMillion: 0.05, outputPerMillion: 0.08 },
  "llama3-70b-8192": { inputPerMillion: 0.59, outputPerMillion: 0.79 },
  "llama-3.1-8b-instant": { inputPerMillion: 0.05, outputPerMillion: 0.08 },

  // Anything self-hosted is free at the API boundary.
  "llama3": { inputPerMillion: 0, outputPerMillion: 0 },
  "mock": { inputPerMillion: 0, outputPerMillion: 0 }
};

export function lookupPrice(model: string): TokenPrice | undefined {
  if (PRICING[model]) {
    return PRICING[model];
  }

  // Longest matching prefix wins, so "claude-3-5-haiku-20241022" resolves.
  let best: { key: string; price: TokenPrice } | undefined;
  for (const [key, price] of Object.entries(PRICING)) {
    if (model.startsWith(key) && (!best || key.length > best.key.length)) {
      best = { key, price };
    }
  }

  return best?.price;
}

export function estimateCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number
): number | undefined {
  const price = lookupPrice(model);
  if (!price) {
    return undefined;
  }

  const cost =
    (inputTokens / 1_000_000) * price.inputPerMillion +
    (outputTokens / 1_000_000) * price.outputPerMillion;

  // Sub-cent costs are the norm here; keep enough precision to stay non-zero.
  return Number(cost.toFixed(8));
}
