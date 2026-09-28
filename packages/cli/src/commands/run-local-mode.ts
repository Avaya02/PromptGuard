import { runEvaluation, type PromptEvaluationResult } from "@promptguard/evaluator";
import { selectCasesForPrompt } from "@promptguard/shared-types";

import type { TestModeContext } from "./test-command.js";
import { createProvider } from "../providers/create-provider.js";

export async function runLocalMode(context: TestModeContext): Promise<PromptEvaluationResult[]> {
  const generationProvider = createProvider(context.config.generationModel);
  const judgeProvider = createProvider(context.config.judgeModel);

  const promptResults: PromptEvaluationResult[] = [];

  for (const prompt of context.currentPrompts) {
    const testCases = selectCasesForPrompt(context.testCases, prompt.name);
    if (testCases.length === 0) {
      continue;
    }

    const baselinePrompt = context.baselineByName.get(prompt.name);
    const result = await runEvaluation({
      promptName: prompt.name,
      versionB: prompt.content,
      testCases,
      threshold: context.config.threshold,
      generationProvider,
      judgeProvider,
      ...(context.config.concurrency !== undefined
        ? { concurrency: context.config.concurrency }
        : {}),
      ...(baselinePrompt !== undefined ? { versionA: baselinePrompt } : {})
    });

    promptResults.push(result);
  }

  return promptResults;
}
