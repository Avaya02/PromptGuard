import type { CaseEvaluationResult } from "@promptguard/shared-types";

import { toJudgeCase } from "../prompts/judge-templates.js";
import type { EvaluationTestCase, RunEvaluationInput } from "../types.js";
import { formatFailures, runAssertions } from "./run-assertions.js";

interface EvaluateCaseInput {
  index: number;
  testCase: EvaluationTestCase;
  versionA?: string;
  versionB: string;
  generationProvider: RunEvaluationInput["generationProvider"];
  judgeProvider: RunEvaluationInput["judgeProvider"];
}

/**
 * Evaluates a single case through a two-stage pipeline:
 *
 *   1. Deterministic assertions (local, zero tokens). A failure short-circuits
 *      here and the judge is never called.
 *   2. LLM judge, only when every deterministic check passed and a rubric is set.
 *
 * Stage 1 is what makes a fully offline, zero-cost run possible.
 */
export async function evaluateCase(input: EvaluateCaseInput): Promise<CaseEvaluationResult> {
  const startedAt = Date.now();
  const prepared = toJudgeCase(input.testCase);
  const testName = prepared.name || `case-${input.index + 1}`;

  try {
    const generationStartedAt = Date.now();
    const responseB = await input.generationProvider.generate(input.versionB, prepared.input);
    const generationLatencyMs = Date.now() - generationStartedAt;

    // --- Stage 1: deterministic checks -------------------------------------
    if (input.testCase.assert !== undefined) {
      const outcome = runAssertions(input.testCase.assert, responseB, generationLatencyMs);

      if (!outcome.pass) {
        return {
          testName,
          pass: false,
          driftScore: 1,
          reason: formatFailures(outcome.failures),
          latencyMs: Date.now() - startedAt,
          tokensUsed: 0,
          assertionType: "deterministic",
          estimatedCostUsd: 0
        };
      }

      // Deterministic-only case: passed, and there is no rubric to judge.
      if (prepared.expect === null || prepared.expect === undefined) {
        return {
          testName,
          pass: true,
          driftScore: 0,
          reason: "All deterministic assertions passed.",
          latencyMs: Date.now() - startedAt,
          tokensUsed: 0,
          assertionType: "deterministic",
          estimatedCostUsd: 0
        };
      }
    }

    // --- Stage 2: LLM judge -------------------------------------------------
    // Baseline generation is only needed for A/B comparison, which applies when
    // no rubric was supplied.
    const responseA =
      (prepared.expect === null || prepared.expect === undefined) && input.versionA
        ? await input.generationProvider.generate(input.versionA, prepared.input)
        : undefined;

    const judgeInput = {
      input: prepared.input,
      responseB,
      expect: prepared.expect ?? null
    };

    const judgeResult = await input.judgeProvider.judge(
      responseA !== undefined ? { ...judgeInput, responseA } : judgeInput
    );

    return {
      testName,
      pass: judgeResult.pass,
      driftScore: judgeResult.drift,
      reason: judgeResult.reason,
      latencyMs: Date.now() - startedAt,
      tokensUsed: judgeResult.tokensUsed ?? 0,
      assertionType: "semantic",
      ...(judgeResult.estimatedCostUsd !== undefined
        ? { estimatedCostUsd: judgeResult.estimatedCostUsd }
        : {})
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown evaluation error.";
    return {
      testName,
      pass: false,
      driftScore: 1,
      reason: message,
      latencyMs: Date.now() - startedAt,
      tokensUsed: 0,
      assertionType: input.testCase.assert !== undefined ? "deterministic" : "semantic"
    };
  }
}
