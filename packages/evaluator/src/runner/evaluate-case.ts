import type { CaseEvaluationResult } from "@promptguard/shared-types";

import { toJudgeCase } from "../prompts/judge-templates.js";
import type { EvaluationTestCase, RunEvaluationInput } from "../types.js";

interface EvaluateCaseInput {
  index: number;
  testCase: EvaluationTestCase;
  versionA?: string;
  versionB: string;
  generationProvider: RunEvaluationInput["generationProvider"];
  judgeProvider: RunEvaluationInput["judgeProvider"];
}

export async function evaluateCase(input: EvaluateCaseInput): Promise<CaseEvaluationResult> {
  const startedAt = Date.now();
  const prepared = toJudgeCase(input.testCase);

  try {
    const responseA =
      prepared.expect === null && input.versionA
        ? await input.generationProvider.generate(input.versionA, prepared.input)
        : undefined;

    const responseB = await input.generationProvider.generate(input.versionB, prepared.input);
    const judgeInput = {
      input: prepared.input,
      responseB,
      expect: prepared.expect
    };
    const judgeResult = await input.judgeProvider.judge(
      responseA !== undefined ? { ...judgeInput, responseA } : judgeInput
    );

    return {
      testName: prepared.name || `case-${input.index + 1}`,
      pass: judgeResult.pass,
      driftScore: judgeResult.drift,
      reason: judgeResult.reason,
      latencyMs: Date.now() - startedAt,
      tokensUsed: judgeResult.tokensUsed ?? 0
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown evaluation error.";
    return {
      testName: prepared.name || `case-${input.index + 1}`,
      pass: false,
      driftScore: 1,
      reason: message,
      latencyMs: Date.now() - startedAt,
      tokensUsed: 0
    };
  }
}
