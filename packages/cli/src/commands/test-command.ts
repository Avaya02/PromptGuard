import type { EvaluationTestCase, PromptEvaluationResult } from "@promptguard/evaluator";
import type { PromptGuardConfig, RegisteredPrompt } from "@promptguard/shared-types";
import chalk from "chalk";
import ora from "ora";

import { runLocalMode } from "./run-local-mode.js";
import { runRemoteMode } from "./run-remote-mode.js";
import { loadConfig } from "../config/load-config.js";
import { PromptGuardCliError } from "../errors.js";
import { EXIT } from "../exit-codes.js";
import { loadBaselinePrompts } from "../prompts/load-baseline-prompts.js";
import { loadCurrentPrompts } from "../prompts/load-current-prompts.js";
import { buildJsonReport } from "../reporter/json-report.js";
import { printReport } from "../reporter/print-report.js";
import { loadTestCases } from "../tests/load-test-cases.js";
import { CLI_VERSION } from "../version.js";

export interface TestCommandArgs {
  base?: string | undefined;
  /** Emit a machine-readable report on stdout instead of the human one. */
  json?: boolean | undefined;
}

export interface TestModeContext {
  cwd: string;
  config: PromptGuardConfig;
  currentPrompts: RegisteredPrompt[];
  testCases: EvaluationTestCase[];
  baselineByName: Map<string, string>;
}

/** Scope names in test files that match no registered prompt, so never run. */
export function findUnknownScopes(
  testCases: EvaluationTestCase[],
  prompts: RegisteredPrompt[]
): string[] {
  const known = new Set(prompts.map((prompt) => prompt.name));
  const unknown = new Set<string>();

  for (const testCase of testCases) {
    for (const name of testCase.prompts ?? []) {
      if (!known.has(name)) {
        unknown.add(name);
      }
    }
  }

  return [...unknown].sort();
}

function modelLabel(config: PromptGuardConfig): string {
  const generation = `${config.generationModel.provider}:${config.generationModel.model}`;
  const judge = `${config.judgeModel.provider}:${config.judgeModel.model}`;
  return generation === judge ? generation : `${generation} → judge ${judge}`;
}

export async function runTestCommand(args: TestCommandArgs): Promise<number> {
  const cwd = process.cwd();
  const json = args.json === true;
  const startedAt = Date.now();

  // The spinner is decoration for a person watching; in CI logs or JSON mode it
  // only adds noise, so it is silenced entirely rather than degraded.
  const spinner = ora({
    text: "Loading configuration",
    stream: process.stderr,
    isSilent: json || !process.stderr.isTTY
  }).start();

  try {
    const config = await loadConfig(cwd);
    const currentPrompts = await loadCurrentPrompts(cwd);
    const testCases = await loadTestCases(cwd, config.testsDir);

    const unknownScopes = findUnknownScopes(testCases, currentPrompts);

    spinner.text = "Resolving baseline prompts";
    const baselineByName = args.base
      ? await loadBaselinePrompts(cwd, args.base)
      : new Map<string, string>();

    const context: TestModeContext = { cwd, config, currentPrompts, testCases, baselineByName };

    const apiUrl = process.env.PROMPTGUARD_API_URL;
    let promptResults: PromptEvaluationResult[];
    let remoteStatus: "COMPLETED" | "FAILED" | null = null;

    if (apiUrl) {
      const remote = await runRemoteMode(apiUrl, spinner, context);
      promptResults = remote.results;
      remoteStatus = remote.status;
    } else {
      spinner.text = "Running evaluations";
      promptResults = await runLocalMode(context);
    }

    spinner.stop();
    const durationMs = Date.now() - startedAt;

    if (json) {
      process.stdout.write(
        `${JSON.stringify(buildJsonReport({ threshold: config.threshold, results: promptResults, durationMs }), null, 2)}\n`
      );
    } else {
      const caseCount = promptResults.reduce((total, result) => total + result.totalTests, 0);
      console.log(
        chalk.dim(
          `\n PromptGuard ${CLI_VERSION} · ${modelLabel(config)} · ${promptResults.length} prompt${promptResults.length === 1 ? "" : "s"} · ${caseCount} case${caseCount === 1 ? "" : "s"}`
        )
      );

      for (const name of unknownScopes) {
        console.log(
          `${chalk.yellow(" ⚠")} test files target ${chalk.bold(name)}, which is not registered — those cases were skipped`
        );
      }

      if (args.base && baselineByName.size === 0) {
        console.log(
          `${chalk.yellow(" ⚠")} no baseline found at ${chalk.bold(args.base)} — is .promptguard/prompts.json committed there?`
        );
      }

      printReport({ threshold: config.threshold, results: promptResults, durationMs });
    }

    if (remoteStatus === "FAILED") {
      return EXIT.regression;
    }

    return promptResults.every((result) => result.pass) ? EXIT.ok : EXIT.regression;
  } catch (error) {
    spinner.stop();

    const message = error instanceof Error ? error.message : "PromptGuard test run failed.";
    const hint = error instanceof PromptGuardCliError ? error.hint : undefined;

    if (json) {
      process.stdout.write(
        `${JSON.stringify({ schemaVersion: 1, pass: false, error: { message, ...(hint ? { hint } : {}) } }, null, 2)}\n`
      );
    } else {
      console.error(`\n${chalk.red("✗")} ${message}`);
      if (hint) {
        console.error(`  ${hint}\n`);
      }
    }

    return EXIT.error;
  }
}
