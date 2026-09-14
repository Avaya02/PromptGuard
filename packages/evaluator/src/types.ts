import type { LLMProvider } from "@promptguard/llm-provider";
import type { EvaluationResult, NamedTestCase } from "@promptguard/shared-types";

export type EvaluationTestCase = NamedTestCase;

export interface RunEvaluationInput {
  promptName: string;
  versionA?: string;
  versionB: string;
  testCases: EvaluationTestCase[];
  threshold: number;
  generationProvider: LLMProvider;
  judgeProvider: LLMProvider;
  /** Max cases evaluated in parallel. Defaults to DEFAULT_CONCURRENCY (5). */
  concurrency?: number;
}

export interface PromptEvaluationResult extends EvaluationResult {
  promptName: string;
}
