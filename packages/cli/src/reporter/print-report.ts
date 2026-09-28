import chalk from "chalk";

import type { PromptEvaluationResult } from "@promptguard/evaluator";

import { summarize } from "./summarize.js";

export interface PrintReportInput {
  threshold: number;
  results: PromptEvaluationResult[];
  durationMs?: number | undefined;
  /** Where lines go; injectable so tests do not scrape console output. */
  write?: ((line: string) => void) | undefined;
}

const MAX_NAME_WIDTH = 40;

function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(2)}s`;
}

function formatCost(usd: number): string {
  if (usd === 0) {
    return "$0";
  }
  return usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`;
}

function truncate(text: string, width: number): string {
  return text.length <= width ? text : `${text.slice(0, width - 1)}…`;
}

/**
 * Human-readable report, grouped by prompt.
 *
 * Passing cases stay to one line each; failures get their reason printed
 * underneath, since the reason is the only thing a reader needs to act on.
 */
export function printReport(input: PrintReportInput): void {
  const write = input.write ?? ((line: string) => console.log(line));
  const stats = summarize(input.results);

  const nameWidth = Math.min(
    MAX_NAME_WIDTH,
    Math.max(8, ...input.results.flatMap((r) => r.results.map((c) => c.testName.length)))
  );

  write("");

  for (const prompt of input.results) {
    write(` ${chalk.bold(prompt.promptName)}`);

    for (const testCase of prompt.results) {
      const mark = testCase.pass ? chalk.green("✓") : chalk.red("✗");
      const name = truncate(testCase.testName, nameWidth).padEnd(nameWidth);
      const kind = (testCase.assertionType === "deterministic" ? "assert" : "judge").padEnd(6);
      const latency = formatDuration(testCase.latencyMs).padStart(7);

      write(`   ${mark} ${testCase.pass ? name : chalk.red(name)}  ${chalk.dim(kind)} ${chalk.dim(latency)}`);

      if (!testCase.pass) {
        write(`     ${chalk.dim("└")} ${testCase.reason}`);
      }
    }

    write("");
  }

  const promptWidth = Math.max(0, ...input.results.map((prompt) => prompt.promptName.length));

  for (const prompt of input.results) {
    const drift = prompt.driftScore.toFixed(3);
    const threshold = input.threshold.toFixed(3);
    const name = prompt.promptName.padEnd(promptWidth);

    write(
      prompt.pass
        ? ` ${chalk.green("✓")} ${name}  ${chalk.dim(`drift ${drift} ≤ ${threshold}`)}`
        : ` ${chalk.red("✗")} ${name}  ${chalk.red(`drift ${drift} > ${threshold}`)}  ${chalk.red("regressed")}`
    );
  }

  const caseLine = [
    stats.casesFailed === 0
      ? chalk.green(`${stats.cases} passed`)
      : `${chalk.green(`${stats.cases - stats.casesFailed} passed`)}, ${chalk.red(`${stats.casesFailed} failed`)}`,
    `${stats.deterministic} zero-cost`,
    `${stats.tokensUsed.toLocaleString("en-US")} tokens`,
    formatCost(stats.estimatedCostUsd)
  ].join(chalk.dim(" · "));

  const timing = input.durationMs !== undefined ? chalk.dim(`  (${formatDuration(input.durationMs)})`) : "";
  // Padded badges only read as badges with a background colour; without colour
  // (NO_COLOR, CI logs) the padding would just look like misalignment.
  const badge = (label: string, paint: (text: string) => string): string =>
    chalk.level > 0 ? paint(` ${label} `) : label;

  const verdict = stats.pass
    ? badge("PASS", chalk.bgGreen.black)
    : `${badge("FAIL", chalk.bgRed.white)} ${stats.promptsFailed} of ${stats.prompts} prompt${stats.prompts === 1 ? "" : "s"} regressed`;

  write("");
  write(` ${chalk.dim("Cases ")}  ${caseLine}`);
  write(` ${chalk.dim("Result")}  ${verdict}${timing}`);
  write("");
}
