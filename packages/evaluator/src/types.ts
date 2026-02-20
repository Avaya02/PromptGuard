import type { LLMProvider } from "@promptguard/llm-provider";
import type { EvaluationResult, TestCase } from "@promptguard/shared-types";

export interface EvaluationTestCase extends TestCase {
  name: string;
}

export interface RunEvaluationInput {
  promptName: string;
  versionA?: string;
  versionB: string;
  testCases: EvaluationTestCase[];
  threshold: number;
  generationProvider: LLMProvider;
  judgeProvider: LLMProvider;
}

export interface PromptEvaluationResult extends EvaluationResult {
  promptName: string;
}
