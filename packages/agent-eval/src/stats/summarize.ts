import type { ExperimentResult, TrialResult } from "../types.js";
import { mean, pairedBootstrap, wilsonInterval, type DifferenceEstimate, type Interval } from "./stats.js";

export interface CheckTally {
  check: string;
  failed: number;
  total: number;
  /** A representative failure detail, e.g. the offending command. */
  example?: string | undefined;
}

export interface VariantSummary {
  name: string;
  runs: number;
  passed: number;
  passRate: number;
  passRateInterval: Interval;
  failures: { agentError: number; verifyFailed: number; checkFailed: number };
  meanCostUsd: number | null;
  meanTurns: number | null;
  meanContextTokens: number | null;
  meanDurationMs: number | null;
  totalCostUsd: number;
  checks: CheckTally[];
  skillsUsed: Record<string, number>;
  /** Distinct agent errors with counts, e.g. "error_max_turns". */
  errors: Record<string, number>;
  /** Actions the agent attempted that its permissions refused: a confusion signal. */
  permissionDenials: number;
  /** Skills the agent loaded at startup, from any source, as reported by the agent. */
  skillsLoaded: string[];
}

export type Verdict = "better" | "worse" | "no-clear-difference";

export interface Comparison {
  variant: string;
  reference: string;
  passRate: DifferenceEstimate;
  verdict: Verdict;
  /** Relative change versus the reference, e.g. 0.33 for +33%. */
  costChange: number | null;
  turnsChange: number | null;
  /** Absolute change in starting context, in tokens. */
  contextTokensChange: number | null;
}

export interface ExperimentSummary {
  reference: string;
  variants: VariantSummary[];
  comparisons: Comparison[];
}

function relativeChange(candidate: number | null, reference: number | null): number | null {
  if (candidate === null || reference === null || reference === 0) {
    return null;
  }
  return candidate / reference - 1;
}

function summarizeVariant(name: string, results: TrialResult[]): VariantSummary {
  const passed = results.filter((result) => result.passed).length;
  const tallies = new Map<string, CheckTally>();
  const skillsUsed: Record<string, number> = {};
  const errors: Record<string, number> = {};

  for (const result of results) {
    for (const check of result.checks) {
      const tally = tallies.get(check.check) ?? { check: check.check, failed: 0, total: 0 };
      tally.total += 1;
      if (!check.pass) {
        tally.failed += 1;
        tally.example ??= check.detail;
      }
      tallies.set(check.check, tally);
    }
    for (const skill of new Set(result.agent.skillsUsed)) {
      skillsUsed[skill] = (skillsUsed[skill] ?? 0) + 1;
    }
    if (result.failure === "agent-error" && result.agent.error) {
      const key = result.agent.error.split("\n")[0]!.slice(0, 120);
      errors[key] = (errors[key] ?? 0) + 1;
    }
  }

  const costs = results.map((r) => r.agent.costUsd).filter((c): c is number => c !== null);
  const contexts = results.map((r) => r.agent.contextTokens).filter((c): c is number => c !== null);
  // Turns and time are only meaningful for runs where the agent actually ran.
  const ran = results.filter((r) => r.agent.turns > 0);

  return {
    name,
    runs: results.length,
    passed,
    passRate: results.length === 0 ? 0 : passed / results.length,
    passRateInterval: wilsonInterval(passed, results.length),
    failures: {
      agentError: results.filter((r) => r.failure === "agent-error").length,
      verifyFailed: results.filter((r) => r.failure === "verify-failed").length,
      checkFailed: results.filter((r) => r.failure === "check-failed").length
    },
    meanCostUsd: mean(costs),
    meanTurns: mean(ran.map((r) => r.agent.turns)),
    meanContextTokens: mean(contexts),
    meanDurationMs: mean(ran.map((r) => r.agent.durationMs)),
    totalCostUsd: costs.reduce((total, cost) => total + cost, 0),
    checks: [...tallies.values()].sort((a, b) => a.check.localeCompare(b.check)),
    skillsUsed,
    errors,
    permissionDenials: results.reduce((total, r) => total + r.agent.permissionDenials, 0),
    skillsLoaded: [...new Set(results.flatMap((r) => r.agent.environment.skillsLoaded))].sort()
  };
}

/**
 * Summarises an experiment and compares every setup against a reference.
 *
 * The reference defaults to the first setup that is not the "none" baseline,
 * which in `compare main working` is `main`: the question being asked is
 * whether the change beats what is committed.
 */
export function summarizeExperiment(experiment: ExperimentResult, referenceName?: string): ExperimentSummary {
  const names = experiment.variants.map((variant) => variant.name);
  const reference =
    referenceName ?? names.find((name) => name !== "none") ?? names[0] ?? "";

  const byVariant = new Map<string, TrialResult[]>();
  for (const name of names) {
    byVariant.set(name, experiment.results.filter((result) => result.variant === name));
  }

  const variants = names.map((name) => summarizeVariant(name, byVariant.get(name) ?? []));
  const referenceSummary = variants.find((variant) => variant.name === reference);

  const comparisons: Comparison[] = [];
  for (const variant of variants) {
    if (variant.name === reference || !referenceSummary) {
      continue;
    }

    const paired = experiment.tasks.map((task) => ({
      reference: (byVariant.get(reference) ?? []).filter((r) => r.taskId === task.id).map((r) => r.passed),
      candidate: (byVariant.get(variant.name) ?? []).filter((r) => r.taskId === task.id).map((r) => r.passed)
    }));

    const estimate = pairedBootstrap(paired);
    const verdict: Verdict = estimate.low > 0 ? "better" : estimate.high < 0 ? "worse" : "no-clear-difference";

    comparisons.push({
      variant: variant.name,
      reference,
      passRate: estimate,
      verdict,
      costChange: relativeChange(variant.meanCostUsd, referenceSummary.meanCostUsd),
      turnsChange: relativeChange(variant.meanTurns, referenceSummary.meanTurns),
      contextTokensChange:
        variant.meanContextTokens !== null && referenceSummary.meanContextTokens !== null
          ? variant.meanContextTokens - referenceSummary.meanContextTokens
          : null
    });
  }

  return { reference, variants, comparisons };
}
