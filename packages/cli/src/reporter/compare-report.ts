import type { Comparison, ExperimentResult, ExperimentSummary, VariantSummary } from "@diditbreak/agent-eval";
import { stripVTControlCharacters } from "node:util";

import chalk from "chalk";

export interface CompareReportInput {
  experiment: ExperimentResult;
  summary: ExperimentSummary;
  /** Variant name to a human description, e.g. "CLAUDE.md › Style" for ablations. */
  labels?: Record<string, string> | undefined;
  resultsPath: string;
  write?: ((line: string) => void) | undefined;
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

// Round half away from zero, so -62.5 shows as -63 and agrees with the 63%
// printed for the same 5/8 in the table above.
function roundPercent(value: number): number {
  return Math.sign(value) * Math.round(Math.abs(value) * 100);
}

function points(value: number): string {
  const rounded = roundPercent(value);
  return `${rounded > 0 ? "+" : rounded < 0 ? "−" : "±"}${Math.abs(rounded)}`;
}

function signedPercent(value: number | null): string {
  if (value === null) {
    return "n/a";
  }
  const rounded = roundPercent(value);
  return `${rounded > 0 ? "+" : rounded < 0 ? "−" : "±"}${Math.abs(rounded)}%`;
}

function tokens(value: number | null): string {
  if (value === null) {
    return "n/a";
  }
  return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(Math.round(value));
}

function signedTokens(value: number | null): string {
  if (value === null) {
    return "n/a";
  }
  const sign = value > 0 ? "+" : value < 0 ? "−" : "±";
  return `${sign}${tokens(Math.abs(value))}`;
}

function money(value: number | null): string {
  if (value === null) {
    return "n/a";
  }
  return value < 0.01 ? `$${value.toFixed(4)}` : `$${value.toFixed(3)}`;
}

function duration(ms: number | null): string {
  if (ms === null) {
    return "n/a";
  }
  const seconds = Math.round(ms / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function pad(text: string, width: number): string {
  // Width from visible characters, so coloured cells still line up.
  const visible = stripVTControlCharacters(text);
  return text + " ".repeat(Math.max(0, width - visible.length));
}

const VERDICT_TEXT = {
  better: chalk.green("better"),
  worse: chalk.red("worse"),
  "no-clear-difference": chalk.yellow("no clear difference")
} as const;

function verdictLine(comparison: Comparison, nameWidth: number, label: string | undefined): string[] {
  const { passRate } = comparison;
  const interval = `95% CI ${points(passRate.low)} … ${points(passRate.high)} pts`;
  const head = `   ${pad(comparison.variant, nameWidth)}  ${pad(`${points(passRate.mean)} pts`, 9)} ${chalk.dim(pad(`(${interval})`, 28))} ${VERDICT_TEXT[comparison.verdict]}`;
  const effects = chalk.dim(
    `${" ".repeat(nameWidth + 5)}cost ${signedPercent(comparison.costChange)} · turns ${signedPercent(comparison.turnsChange)} · starting context ${signedTokens(comparison.contextTokensChange)} tokens`
  );
  const lines = [head, effects];
  if (label) {
    lines.splice(1, 0, chalk.dim(`${" ".repeat(nameWidth + 5)}removes ${label}`));
  }
  return lines;
}

function failureBreakdown(variant: VariantSummary): string | null {
  const parts: string[] = [];
  if (variant.failures.verifyFailed > 0) {
    parts.push(`${variant.failures.verifyFailed} tests failed`);
  }
  if (variant.failures.checkFailed > 0) {
    parts.push(`${variant.failures.checkFailed} broke a rule`);
  }
  if (variant.failures.agentError > 0) {
    const top = Object.entries(variant.errors).sort((a, b) => b[1] - a[1])[0];
    parts.push(`${variant.failures.agentError} agent errors${top ? ` (${top[0]})` : ""}`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * The comparison report: one row per setup, a verdict per setup against the
 * reference, then why runs failed and which behaviour rules broke.
 */
export function printCompareReport(input: CompareReportInput): void {
  const write = input.write ?? ((line: string) => console.log(line));
  const { experiment, summary } = input;
  const nameWidth = Math.max(5, ...summary.variants.map((v) => v.name.length));
  const simulated = experiment.agent.name === "mock";
  const agentLabel = simulated
    ? "mock agent"
    : `${experiment.agent.name} (${experiment.agent.model ?? "default model"})`;

  write("");
  write(
    chalk.dim(
      ` diditbreak · ${agentLabel} · ${experiment.tasks.length} task${experiment.tasks.length === 1 ? "" : "s"} × ${experiment.trials} trial${experiment.trials === 1 ? "" : "s"} · ${experiment.results.length} runs · ${duration(experiment.durationMs)}`
    )
  );
  write("");
  write(
    chalk.dim(
      ` ${pad("setup", nameWidth)}  ${pad("solved", 14)} ${pad("cost/run", 9)} ${pad("turns", 6)} ${pad("context", 8)} time/run`
    )
  );

  for (const variant of summary.variants) {
    const solved = `${variant.passed}/${variant.runs}`.padStart(5);
    const rate = pct(variant.passRate).padStart(4);
    const colour = variant.name === summary.reference ? chalk.bold : (text: string) => text;
    write(
      ` ${colour(pad(variant.name, nameWidth))}  ${pad(`${solved}  ${rate}`, 14)} ${pad(money(variant.meanCostUsd), 9)} ${pad(variant.meanTurns === null ? "n/a" : variant.meanTurns.toFixed(1), 6)} ${pad(tokens(variant.meanContextTokens), 8)} ${duration(variant.meanDurationMs)}`
    );
  }

  if (summary.comparisons.length > 0) {
    write("");
    write(` ${chalk.bold(`vs ${summary.reference}`)}`);
    for (const comparison of summary.comparisons) {
      for (const line of verdictLine(comparison, nameWidth, input.labels?.[comparison.variant])) {
        write(line);
      }
    }
  }

  const breakdowns = summary.variants
    .map((variant) => [variant.name, failureBreakdown(variant)] as const)
    .filter((entry): entry is readonly [string, string] => entry[1] !== null);
  if (breakdowns.length > 0) {
    write("");
    write(` ${chalk.bold("Why runs failed")}`);
    for (const [name, text] of breakdowns) {
      write(`   ${pad(name, nameWidth)}  ${text}`);
    }
  }

  // One row per behaviour rule, showing how often each setup broke it.
  const checkNames = [...new Set(summary.variants.flatMap((v) => v.checks.map((c) => c.check)))].sort();
  const brokenSomewhere = checkNames.filter((name) =>
    summary.variants.some((v) => (v.checks.find((c) => c.check === name)?.failed ?? 0) > 0)
  );
  if (brokenSomewhere.length > 0) {
    write("");
    write(` ${chalk.bold("Rules broken")}  ${chalk.dim("(runs that broke the rule / runs)")}`);
    const ruleWidth = Math.max(...brokenSomewhere.map((name) => name.length));
    for (const name of brokenSomewhere) {
      const cells = summary.variants.map((variant) => {
        const tally = variant.checks.find((c) => c.check === name);
        if (!tally) {
          return chalk.dim(`${variant.name} –`);
        }
        const text = `${variant.name} ${tally.failed}/${tally.total}`;
        return tally.failed > 0 ? chalk.red(text) : chalk.dim(text);
      });
      write(`   ${pad(name, ruleWidth)}  ${cells.join("   ")}`);
      // The concrete offence ("ran: npm install --save-dev jest") is what makes
      // the number actionable.
      const example = summary.variants
        .map((variant) => variant.checks.find((c) => c.check === name)?.example)
        .find((detail) => detail !== undefined);
      if (example) {
        write(chalk.dim(`   ${" ".repeat(ruleWidth)}  e.g. ${example}`));
      }
    }
  }

  const denials = summary.variants.filter((variant) => variant.permissionDenials > 0);
  if (denials.length > 0) {
    write("");
    write(` ${chalk.bold("Blocked actions")}  ${chalk.dim("(attempts the agent's permissions refused)")}`);
    for (const variant of denials) {
      write(`   ${pad(variant.name, nameWidth)}  ${variant.permissionDenials}`);
    }
  }

  const totalCost = summary.variants.reduce((total, v) => total + v.totalCostUsd, 0);
  write("");
  // Skills from the user's machine load in every setup. That keeps comparisons
  // fair, but absolute numbers depend on them, so say so rather than hide it.
  const ambient = ambientSkills(experiment, summary);
  if (ambient.length > 0) {
    write(
      chalk.dim(
        ` Also loaded in every setup: ${ambient.length} skill${ambient.length === 1 ? "" : "s"} not defined in this repo (personal or built-in), e.g. ${ambient.slice(0, 3).join(", ")}.`
      )
    );
  }
  if (simulated) {
    // The mock models effects, not prices: never let its numbers pass for real ones.
    write(chalk.dim(" Mock agent: cost, turns and context are simulated, not measured."));
  }
  write(chalk.dim(` ${simulated ? "Simulated cost" : "Total cost"} ${money(totalCost)} · results in ${input.resultsPath}`));
  write("");
}

/** Skills loaded in every setup, including "none": they came from outside the repo. */
function ambientSkills(experiment: ExperimentResult, summary: ExperimentSummary): string[] {
  if (experiment.agent.name === "mock") {
    return [];
  }
  const loadedEverywhere = summary.variants
    .map((variant) => new Set(variant.skillsLoaded))
    .reduce<Set<string> | null>((common, set) => (common === null ? set : new Set([...common].filter((s) => set.has(s)))), null);
  return [...(loadedEverywhere ?? [])].sort();
}
