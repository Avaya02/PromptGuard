import type { JudgeInput } from "@diditbreak/shared-types";

export function buildJudgePrompt(context: JudgeInput): string {
  if (context.expect) {
    return [
      `Input: ${context.input}`,
      `Response B: ${context.responseB}`,
      `Rubric: ${context.expect}`,
      "Evaluate Response B against the rubric and return JSON:",
      "{\"pass\": boolean, \"reason\": string, \"drift\": number}"
    ].join("\n");
  }

  return [
    `Input: ${context.input}`,
    `Response A: ${context.responseA ?? ""}`,
    `Response B: ${context.responseB}`,
    "Compare response quality and detect regressions. Return JSON:",
    "{\"pass\": boolean, \"reason\": string, \"drift\": number}"
  ].join("\n");
}
