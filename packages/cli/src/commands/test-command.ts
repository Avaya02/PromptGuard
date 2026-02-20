import { runEvaluation, type PromptEvaluationResult } from "@promptguard/evaluator";
import ora from "ora";

import { loadConfig } from "../config/load-config.js";
import { loadBaselinePrompts } from "../prompts/load-baseline-prompts.js";
import { loadCurrentPrompts } from "../prompts/load-current-prompts.js";
import { createProvider } from "../providers/create-provider.js";
import { printReport } from "../reporter/print-report.js";
import { loadTestCases } from "../tests/load-test-cases.js";

export interface TestCommandArgs {
  base?: string | undefined;
}

export async function runTestCommand(args: TestCommandArgs): Promise<number> {
  const cwd = process.cwd();
  const spinner = ora("Loading PromptGuard configuration").start();

  try {
    const config = await loadConfig(cwd);
    const currentPrompts = await loadCurrentPrompts(cwd);
    const testCases = await loadTestCases(cwd, config.testsDir);

    spinner.text = "Preparing providers";
    const generationProvider = createProvider(config.generationModel);
    const judgeProvider = createProvider(config.judgeModel);

    spinner.text = "Resolving baseline prompts";
    const baselineByName = args.base ? await loadBaselinePrompts(cwd, args.base) : new Map<string, string>();

    spinner.text = "Running evaluations";
    const promptResults: PromptEvaluationResult[] = [];

    for (const prompt of currentPrompts) {
      const baselinePrompt = baselineByName.get(prompt.name);
      const result = await runEvaluation({
        promptName: prompt.name,
        versionB: prompt.content,
        testCases,
        threshold: config.threshold,
        generationProvider,
        judgeProvider,
        ...(baselinePrompt !== undefined ? { versionA: baselinePrompt } : {})
      });

      promptResults.push(result);
    }

    spinner.stop();
    printReport({ threshold: config.threshold, results: promptResults });

    const overallPass = promptResults.every((result) => result.pass);
    return overallPass ? 0 : 1;
  } catch (error) {
    spinner.fail(error instanceof Error ? error.message : "PromptGuard test run failed.");
    return 1;
  }
}
