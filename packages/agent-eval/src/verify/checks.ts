import { runShell } from "../sandbox/shell.js";
import type { AgentRunResult, CheckOutcome, TaskChecks, VerifyOutcome } from "../types.js";

/**
 * Glob to RegExp for path checks: `*` stays within a directory, `**` crosses
 * them, and a trailing slash matches everything below a directory.
 */
export function pathMatcher(pattern: string): (path: string) => boolean {
  if (pattern.endsWith("/")) {
    return (path) => path.startsWith(pattern);
  }

  const source = pattern
    .split("**")
    .map((part) => part.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]"))
    .join(".*");
  const regex = new RegExp(`^${source}$`);
  return (path) => regex.test(path);
}

/** Runs verification commands in order, stopping at the first failure. */
export async function runVerify(commands: string[], cwd: string, timeoutMs: number): Promise<VerifyOutcome[]> {
  const outcomes: VerifyOutcome[] = [];

  for (const command of commands) {
    const result = await runShell(command, cwd, timeoutMs);
    outcomes.push({ command, exitCode: result.exitCode, output: result.output.trim() });
    if (result.exitCode !== 0) {
      break;
    }
  }

  return outcomes;
}

/**
 * Behavioural checks over what the agent did, independent of whether the code
 * works: did it follow the rules, use the right skill, stay within budget.
 */
export function evaluateChecks(
  checks: TaskChecks,
  agent: AgentRunResult,
  changedFiles: string[]
): CheckOutcome[] {
  const outcomes: CheckOutcome[] = [];

  for (const pattern of checks.mustChange) {
    const matches = pathMatcher(pattern);
    const hit = changedFiles.some(matches);
    outcomes.push({
      check: `must_change ${pattern}`,
      pass: hit,
      detail: hit ? "changed" : "the agent did not change it"
    });
  }

  for (const pattern of checks.mustNotChange) {
    const matches = pathMatcher(pattern);
    const touched = changedFiles.filter(matches);
    outcomes.push({
      check: `must_not_change ${pattern}`,
      pass: touched.length === 0,
      detail: touched.length === 0 ? "untouched" : `changed ${touched.join(", ")}`
    });
  }

  for (const needle of checks.forbidCommands) {
    const offending = agent.commands.filter((command) => command.includes(needle));
    outcomes.push({
      check: `forbid_command ${needle}`,
      pass: offending.length === 0,
      detail: offending.length === 0 ? "never ran" : `ran: ${offending[0]}`
    });
  }

  for (const skill of checks.expectSkills) {
    const used = agent.skillsUsed.includes(skill);
    const loaded = agent.environment.skillsLoaded.includes(skill);
    outcomes.push({
      check: `expect_skill ${skill}`,
      pass: used,
      // "Not loaded" and "loaded but ignored" need different fixes.
      detail: used ? "invoked" : loaded ? "loaded but not invoked" : "not loaded in this setup"
    });
  }

  for (const skill of checks.forbidSkills) {
    const used = agent.skillsUsed.includes(skill);
    outcomes.push({
      check: `forbid_skill ${skill}`,
      pass: !used,
      detail: used ? "invoked when it should not have been" : "not invoked"
    });
  }

  if (checks.maxTurns !== undefined) {
    outcomes.push({
      check: `max_turns ${checks.maxTurns}`,
      pass: agent.turns <= checks.maxTurns,
      detail: `${agent.turns} turns`
    });
  }

  if (checks.maxCostUsd !== undefined) {
    const cost = agent.costUsd;
    outcomes.push({
      check: `max_cost_usd ${checks.maxCostUsd}`,
      pass: cost !== null && cost <= checks.maxCostUsd,
      detail: cost === null ? "cost unknown" : `$${cost.toFixed(4)}`
    });
  }

  return outcomes;
}
