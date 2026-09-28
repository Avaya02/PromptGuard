import type { PromptEvaluationResult } from "@promptguard/evaluator";

import { summarize, type RunSummaryStats } from "./summarize.js";

/**
 * Stable machine-readable report for CI and scripts.
 *
 * `schemaVersion` lets consumers detect a breaking change to this shape
 * rather than failing on a missing field.
 */
export interface JsonReport {
  schemaVersion: 1;
  pass: boolean;
  threshold: number;
  durationMs: number | null;
  summary: RunSummaryStats;
  prompts: PromptEvaluationResult[];
}

export function buildJsonReport(input: {
  threshold: number;
  results: PromptEvaluationResult[];
  durationMs?: number | undefined;
}): JsonReport {
  const summary = summarize(input.results);

  return {
    schemaVersion: 1,
    pass: summary.pass,
    threshold: input.threshold,
    durationMs: input.durationMs ?? null,
    summary,
    prompts: input.results
  };
}
