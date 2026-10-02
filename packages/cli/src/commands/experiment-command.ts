import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { createInterface } from "node:readline/promises";

import {
  BASELINE,
  ClaudeCodeAdapter,
  GitError,
  MockAgentAdapter,
  TaskFileError,
  buildVariants,
  loadTasks,
  parseExperimentSettings,
  planAblation,
  readContextFiles,
  repoRoot as findRepoRoot,
  runExperiment,
  summarizeExperiment,
  variantFromToken,
  type AgentAdapter,
  type AgentTask,
  type ExperimentResult,
  type ExperimentSettings,
  type ExperimentSummary,
  type Variant
} from "@diditbreak/agent-eval";
import chalk from "chalk";
import { execa } from "execa";
import ora from "ora";

import { loadConfigModule } from "../config/load-config.js";
import { CliError } from "../errors.js";
import { EXIT } from "../exit-codes.js";
import { printCompareReport } from "../reporter/compare-report.js";

export interface ExperimentOptions {
  trials?: number | undefined;
  tasks?: string | undefined;
  agent?: string | undefined;
  model?: string | undefined;
  concurrency?: number | undefined;
  yes?: boolean | undefined;
  json?: boolean | undefined;
}

export interface CompareCommandArgs extends ExperimentOptions {
  setups: string[];
  baseline?: boolean | undefined;
  reference?: string | undefined;
}

export interface AblateCommandArgs extends ExperimentOptions {
  file?: string | undefined;
  from?: string | undefined;
  skills?: boolean | undefined;
}

interface Prepared {
  root: string;
  settings: ExperimentSettings;
  tasks: AgentTask[];
  adapter: AgentAdapter;
}

async function prepare(options: ExperimentOptions): Promise<Prepared> {
  const cwd = process.cwd();

  let root: string;
  try {
    root = await findRepoRoot(cwd);
  } catch {
    throw new CliError("Not inside a git repository.", "Agent experiments sandbox the repo with git worktrees; run this from a git checkout.");
  }

  const settings = parseExperimentSettings(await loadConfigModule(root, { required: false }));
  if (options.agent !== undefined) {
    if (options.agent !== "claude-code" && options.agent !== "mock") {
      throw new CliError(`Unknown agent "${options.agent}".`, "Use claude-code or mock.");
    }
    settings.agent.name = options.agent;
  }
  if (options.model !== undefined) {
    settings.agent.model = options.model;
  }
  if (options.trials !== undefined) {
    settings.trials = options.trials;
  }
  if (options.concurrency !== undefined) {
    settings.concurrency = options.concurrency;
  }
  if (options.tasks !== undefined) {
    settings.tasksDir = options.tasks;
  }

  let tasks: AgentTask[];
  try {
    tasks = await loadTasks(root, settings.tasksDir);
  } catch (error) {
    if (error instanceof TaskFileError) {
      throw new CliError(error.message, `Tasks live in ${settings.tasksDir}/*.yaml. Run \`diditbreak init --agent\` for a working example.`);
    }
    throw error;
  }

  if (tasks.length === 0) {
    throw new CliError(`No tasks in ${settings.tasksDir}.`, "Add a task file, or run `diditbreak init --agent` for an example.");
  }

  for (const ref of new Set(tasks.map((task) => task.base))) {
    await assertRef(root, ref, "task base");
  }

  const adapter: AgentAdapter = settings.agent.name === "mock" ? new MockAgentAdapter() : new ClaudeCodeAdapter();
  return { root, settings, tasks, adapter };
}

async function assertRef(root: string, ref: string, what: string): Promise<void> {
  const result = await execa("git", ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], { cwd: root, reject: false });
  if (result.exitCode !== 0) {
    throw new CliError(`Unknown git ref "${ref}" (${what}).`, "Use a branch, tag or commit, or `working` / `none`.");
  }
}

async function confirm(prepared: Prepared, variants: Variant[], options: ExperimentOptions): Promise<boolean> {
  const runs = variants.length * prepared.tasks.length * prepared.settings.trials;
  const { agent } = prepared.settings;
  const plan = `${variants.length} setups × ${prepared.tasks.length} tasks × ${prepared.settings.trials} trials = ${runs} agent runs`;

  if (agent.name === "mock" || options.yes) {
    if (!options.json) {
      console.error(chalk.dim(` ${plan}`));
    }
    return true;
  }

  // The per-run budget is enforced by the agent, so this bound is real.
  const ceiling = runs * agent.maxBudgetUsd;
  const message = ` ${plan}\n Spend is capped at $${agent.maxBudgetUsd} per run: at most $${ceiling.toFixed(2)} in total.`;

  if (!process.stdin.isTTY) {
    throw new CliError(`${plan} would start without confirmation.`, "Pass --yes to run non-interactively (CI).");
  }

  console.error(message);
  const prompt = createInterface({ input: process.stdin, output: process.stderr });
  const answer = await prompt.question(" Continue? [y/N] ");
  prompt.close();
  return /^y(es)?$/i.test(answer.trim());
}

function runId(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").replace(/Z$/, "");
}

async function execute(
  prepared: Prepared,
  variants: Variant[],
  options: ExperimentOptions
): Promise<{ experiment: ExperimentResult; resultsPath: string } | null> {
  if (!(await confirm(prepared, variants, options))) {
    console.error(" Cancelled.");
    return null;
  }

  const id = runId();
  const runsRoot = join(prepared.root, ".diditbreak", "runs");
  const runDir = join(runsRoot, id);
  await mkdir(runsRoot, { recursive: true });
  // Self-ignoring: run artifacts stay out of git without editing the user's
  // .gitignore, and without ignoring the prompt registry next to it.
  await writeFile(join(runsRoot, ".gitignore"), "*\n");

  const interactive = process.stderr.isTTY && !options.json;
  const spinner = ora({ text: "Starting", stream: process.stderr, isSilent: !interactive }).start();

  const experiment = await runExperiment({
    repoRoot: prepared.root,
    runDir,
    runId: id,
    tasks: prepared.tasks,
    variants,
    agent: prepared.adapter,
    config: prepared.settings.agent,
    trials: prepared.settings.trials,
    concurrency: prepared.settings.concurrency,
    setup: prepared.settings.setup,
    onProgress: ({ done, total, last }) => {
      const mark = last.passed ? chalk.green("✓") : chalk.red("✗");
      const line = `${done}/${total} ${mark} ${last.variant} × ${last.taskId} #${last.trial}`;
      spinner.text = line;
      // In CI there is no spinner, so log each run: long jobs need a heartbeat.
      if (!interactive && !options.json) {
        console.error(` [${done}/${total}] ${last.variant} × ${last.taskId} #${last.trial} ${last.passed ? "passed" : `failed (${last.failure})`}`);
      }
    }
  });

  spinner.stop();
  return { experiment, resultsPath: relative(process.cwd(), join(runDir, "results.json")) };
}

function emit(
  experiment: ExperimentResult,
  summary: ExperimentSummary,
  resultsPath: string,
  options: ExperimentOptions,
  labels?: Record<string, string>
): void {
  if (options.json) {
    process.stdout.write(`${JSON.stringify({ schemaVersion: 1, id: experiment.id, resultsPath, summary }, null, 2)}\n`);
    return;
  }
  printCompareReport({ experiment, summary, resultsPath, labels });
}

function handleError(error: unknown, options: ExperimentOptions): number {
  const message = error instanceof Error ? error.message : String(error);
  const hint = error instanceof CliError ? error.hint : error instanceof GitError ? "Check that the repository and refs are valid." : undefined;

  if (options.json) {
    process.stdout.write(`${JSON.stringify({ schemaVersion: 1, error: { message, ...(hint ? { hint } : {}) } }, null, 2)}\n`);
  } else {
    console.error(`\n${chalk.red("✗")} ${message}`);
    if (hint) {
      console.error(`  ${hint}\n`);
    }
  }
  return EXIT.error;
}

/**
 * `diditbreak compare [setups...]`: run the same tasks under several context
 * setups and report whether each is better or worse than the reference.
 * Exits 1 when the last setup is clearly worse, so it can gate a CI job.
 */
export async function runCompareCommand(args: CompareCommandArgs): Promise<number> {
  try {
    const prepared = await prepare(args);
    const variants = buildVariants(args.setups, { baseline: args.baseline !== false });

    for (const variant of variants) {
      if (variant.context.kind === "ref") {
        await assertRef(prepared.root, variant.context.ref, "setup");
      }
    }

    const outcome = await execute(prepared, variants, args);
    if (!outcome) {
      return EXIT.ok;
    }

    const summary = summarizeExperiment(outcome.experiment, args.reference);
    emit(outcome.experiment, summary, outcome.resultsPath, args);

    const candidate = [...variants].reverse().find((v) => v.name !== BASELINE && v.name !== summary.reference);
    const verdict = summary.comparisons.find((c) => c.variant === candidate?.name)?.verdict;
    return verdict === "worse" ? EXIT.regression : EXIT.ok;
  } catch (error) {
    return handleError(error, args);
  }
}

/**
 * `diditbreak ablate [file]`: remove one section of the context file (and one
 * skill) at a time, to find which part helps and which part hurts.
 */
export async function runAblateCommand(args: AblateCommandArgs): Promise<number> {
  try {
    const prepared = await prepare(args);
    const file = args.file ?? "CLAUDE.md";
    const source = variantFromToken(args.from ?? "working").context;

    if (source.kind === "ref") {
      await assertRef(prepared.root, source.ref, "--from");
    }
    if (source.kind === "none") {
      throw new CliError("Nothing to ablate in the empty setup.", "Use --from working (default) or a git ref.");
    }

    const files = await readContextFiles(prepared.root, source);
    const plan = planAblation(source, files, { file, includeSkills: args.skills !== false });

    if (plan.variants.length === 1) {
      throw new CliError(
        `Nothing to remove: ${file} has no sections${args.skills !== false ? " and there are no skills" : ""}.`,
        `Ablation needs a ${file} with "##" sections, or skills under .claude/skills/.`
      );
    }

    const outcome = await execute(prepared, plan.variants, args);
    if (!outcome) {
      return EXIT.ok;
    }

    const summary = summarizeExperiment(outcome.experiment, "full");
    emit(outcome.experiment, summary, outcome.resultsPath, args, plan.removed);
    return EXIT.ok;
  } catch (error) {
    return handleError(error, args);
  }
}

export interface ReportCommandArgs {
  path?: string | undefined;
  reference?: string | undefined;
  json?: boolean | undefined;
}

/**
 * `diditbreak report [results.json]`: re-render a finished experiment without
 * running anything. Defaults to the most recent run.
 */
export async function runReportCommand(args: ReportCommandArgs): Promise<number> {
  try {
    let path = args.path;
    if (path === undefined) {
      let root: string;
      try {
        root = await findRepoRoot(process.cwd());
      } catch {
        root = process.cwd();
      }
      const runsRoot = join(root, ".diditbreak", "runs");
      const runs = (await readdir(runsRoot).catch(() => [] as string[])).filter((name) => !name.startsWith(".")).sort();
      const latest = runs.at(-1);
      if (latest === undefined) {
        throw new CliError("No experiment results yet.", "Run `diditbreak compare` first.");
      }
      path = join(runsRoot, latest, "results.json");
    }

    let experiment: ExperimentResult;
    try {
      experiment = JSON.parse(await readFile(path, "utf-8")) as ExperimentResult;
    } catch {
      throw new CliError(`Cannot read results from ${path}.`, "Pass a results.json written by `diditbreak compare`.");
    }

    const summary = summarizeExperiment(experiment, args.reference);
    emit(experiment, summary, relative(process.cwd(), path), args);
    return EXIT.ok;
  } catch (error) {
    return handleError(error, args);
  }
}
