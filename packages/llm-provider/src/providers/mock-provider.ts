import type { JudgeInput, JudgeResult } from "@promptguard/shared-types";

import type { LLMProvider } from "../llm-provider.js";

export interface MockProviderOptions {
  generatedOutput?: string;
  judgeResult?: Partial<JudgeResult>;
}

const DEFAULT_JUDGE_RESULT: JudgeResult = {
  pass: true,
  reason: "Mock judge accepted response.",
  drift: 0
};

export class MockProvider implements LLMProvider {
  private readonly generatedOutput: string;
  private readonly judgeResult: JudgeResult;

  constructor(options: MockProviderOptions = {}) {
    this.generatedOutput = options.generatedOutput ?? "mock-output";
    this.judgeResult = {
      ...DEFAULT_JUDGE_RESULT,
      ...options.judgeResult
    };
  }

  async generate(_prompt: string, input: string): Promise<string> {
    return `${this.generatedOutput}:${input}`;
  }

  async judge(_context: JudgeInput): Promise<JudgeResult> {
    return this.judgeResult;
  }
}
