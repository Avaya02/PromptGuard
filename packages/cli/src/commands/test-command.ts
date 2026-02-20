import type { EvaluationTestCase, PromptEvaluationResult } from "@promptguard/evaluator";
import type { PromptGuardConfig, RegisteredPrompt } from "@promptguard/shared-types";
import ora from "ora";

import { runLocalMode } from "./run-local-mode.js";
import { runRemoteMode } from "./run-remote-mode.js";
import { loadConfig } from "../config/load-config.js";
import { loadBaselinePrompts } from "../prompts/load-baseline-prompts.js";
import { loadCurrentPrompts } from "../prompts/load-current-prompts.js";
import { printReport } from "../reporter/print-report.js";
import { loadTestCases } from "../tests/load-test-cases.js";

export interface TestCommandArgs {
  base?: string | undefined;
}

export interface TestModeContext {
  cwd: string;
  config: PromptGuardConfig;
  currentPrompts: RegisteredPrompt[];
  testCases: EvaluationTestCase[];
  baselineByName: Map<string, string>;
}

export async function runTestCommand(args: TestCommandArgs): Promise<number> {
  const cwd = process.cwd();
  const spinner = ora("Loading PromptGuard configuration").start();

  try {
    const config = await loadConfig(cwd);
    const currentPrompts = await loadCurrentPrompts(cwd);
    const testCases = await loadTestCases(cwd, config.testsDir);

    spinner.text = "Resolving baseline prompts";
    const baselineByName = args.base ? await loadBaselinePrompts(cwd, args.base) : new Map<string, string>();

    const context: TestModeContext = {
      cwd,
      config,
      currentPrompts,
      testCases,
      baselineByName
    };

    const apiUrl = process.env.PROMPTGUARD_API_URL;
    let promptResults: PromptEvaluationResult[];
    let remoteStatus: "COMPLETED" | "FAILED" | null = null;

    if (apiUrl) {
      const remote = await runRemoteMode(apiUrl, spinner, context);
      promptResults = remote.results;
      remoteStatus = remote.status;
    } else {
      spinner.text = "Running local evaluations";
      promptResults = await runLocalMode(context);
    }

    spinner.stop();
    printReport({ threshold: config.threshold, results: promptResults });

    if (remoteStatus === "FAILED") {
      return 1;
    }

    const overallPass = promptResults.every((result) => result.pass);
    return overallPass ? 0 : 1;
  } catch (error) {
    spinner.fail(error instanceof Error ? error.message : "PromptGuard test run failed.");
    return 1;
  }
}
