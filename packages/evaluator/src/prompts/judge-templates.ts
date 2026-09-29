import type { EvaluationTestCase } from "../types.js";

/**
 * Wraps a raw `expect` rubric in judge instructions.
 *
 * `expect` is optional now that cases may be deterministic-only, so absent and
 * null both normalise to null (meaning "no rubric": A/B comparison mode).
 */
export function toJudgeCase(testCase: EvaluationTestCase): EvaluationTestCase {
  if (testCase.expect !== null && testCase.expect !== undefined) {
    return {
      ...testCase,
      expect: [
        `Evaluate Response B against the following rubric: ${testCase.expect}.`,
        "Does it satisfy the criteria without degradation?",
        "Return JSON: {pass: boolean, reason: string, drift: number}"
      ].join("\n")
    };
  }

  return {
    ...testCase,
    expect: null
  };
}
