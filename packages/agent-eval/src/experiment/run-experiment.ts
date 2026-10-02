import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import pLimit from "p-limit";

import { readContextFiles, type ContextFile } from "../context/context-files.js";
import { collectChanges, createSandbox, pruneWorktrees, safeSegment } from "../sandbox/sandbox.js";
import type {
  AgentAdapter,
  AgentConfig,
  AgentRunResult,
  AgentTask,
  ExperimentResult,
  FailureReason,
  TrialResult,
  Variant
} from "../types.js";
import { evaluateChecks, runVerify } from "../verify/checks.js";

export interface ExperimentProgress {
  done: number;
  total: number;
  last: TrialResult;
}

export interface RunExperimentInput {
  repoRoot: string;
  /** Where transcripts, diffs and results.json are written. */
  runDir: string;
  runId: string;
  tasks: AgentTask[];
  variants: Variant[];
  agent: AgentAdapter;
  config: AgentConfig;
  trials: number;
  concurrency: number;
  setup: string[];
  onProgress?: (progress: ExperimentProgress) => void;
}

function emptyAgentResult(error: string): AgentRunResult {
  return {
    completed: false,
    error,
    finalMessage: "",
    turns: 0,
    durationMs: 0,
    costUsd: null,
    inputTokens: 0,
    outputTokens: 0,
    contextTokens: null,
    toolCalls: [],
    skillsUsed: [],
    commands: [],
    permissionDenials: 0,
    environment: { skillsLoaded: [], mcpServers: [], agents: [] }
  };
}

interface Job {
  task: AgentTask;
  variant: Variant;
  trial: number;
}

/**
 * Jobs ordered trial-major, so an interrupted experiment still holds a
 * balanced sample: every setup has run every task once before any runs twice.
 */
export function planJobs(tasks: AgentTask[], variants: Variant[], trials: number): Job[] {
  const jobs: Job[] = [];
  for (let trial = 1; trial <= trials; trial += 1) {
    for (const task of tasks) {
      for (const variant of variants) {
        jobs.push({ task, variant, trial });
      }
    }
  }
  return jobs;
}

async function runTrial(
  input: RunExperimentInput,
  job: Job,
  contextFiles: ContextFile[]
): Promise<TrialResult> {
  const trialDir = join(safeSegment(job.variant.name), safeSegment(job.task.id), String(job.trial));
  const absoluteTrialDir = join(input.runDir, trialDir);
  await mkdir(absoluteTrialDir, { recursive: true });

  const base = {
    variant: job.variant.name,
    taskId: job.task.id,
    trial: job.trial,
    diffPath: join(trialDir, "changes.patch"),
    transcriptPath: join(trialDir, "transcript.jsonl")
  };

  let sandbox;
  try {
    sandbox = await createSandbox({
      repoRoot: input.repoRoot,
      runId: input.runId,
      task: job.task,
      variant: job.variant,
      trial: job.trial,
      contextFiles,
      setup: input.setup,
      setupTimeoutMs: job.task.timeoutSec * 1000
    });
  } catch (error) {
    return {
      ...base,
      passed: false,
      failure: "agent-error",
      verify: [],
      checks: [],
      agent: emptyAgentResult(`sandbox: ${(error as Error).message}`),
      changedFiles: []
    };
  }

  try {
    const config: AgentConfig =
      job.variant.model !== undefined ? { ...input.config, model: job.variant.model } : input.config;

    const agent = await input.agent.run({
      cwd: sandbox.dir,
      prompt: job.task.prompt,
      config,
      timeoutMs: job.task.timeoutSec * 1000,
      transcriptPath: join(input.runDir, base.transcriptPath),
      trial: job.trial,
      context: { paths: sandbox.contextPaths, text: sandbox.contextText },
      mock: job.task.mock
    });

    // Diff before verifying: verification may build or write artifacts that
    // are not the agent's work.
    const changes = await collectChanges(sandbox.dir);
    await writeFile(join(input.runDir, base.diffPath), changes.patch);

    const verify = agent.completed
      ? await runVerify(job.task.verify, sandbox.dir, job.task.timeoutSec * 1000)
      : [];
    const checks = evaluateChecks(job.task.checks, agent, changes.files);

    let failure: FailureReason = null;
    if (!agent.completed) {
      failure = "agent-error";
    } else if (verify.some((outcome) => outcome.exitCode !== 0)) {
      failure = "verify-failed";
    } else if (checks.some((check) => !check.pass)) {
      failure = "check-failed";
    }

    const result: TrialResult = {
      ...base,
      passed: failure === null,
      failure,
      verify,
      checks,
      agent,
      changedFiles: changes.files
    };

    await writeFile(join(absoluteTrialDir, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
    return result;
  } finally {
    await sandbox.cleanup();
  }
}

export async function runExperiment(input: RunExperimentInput): Promise<ExperimentResult> {
  const startedAt = new Date();
  await mkdir(input.runDir, { recursive: true });
  await pruneWorktrees(input.repoRoot);

  // Context is read once per variant, not per trial: the working tree could
  // otherwise change underneath a long experiment.
  const contextByVariant = new Map<string, ContextFile[]>();
  for (const variant of input.variants) {
    contextByVariant.set(variant.name, await readContextFiles(input.repoRoot, variant.context));
  }

  const jobs = planJobs(input.tasks, input.variants, input.trials);
  const limit = pLimit(Math.max(1, input.concurrency));
  let done = 0;

  const results = await Promise.all(
    jobs.map((job) =>
      limit(async () => {
        const result = await runTrial(input, job, contextByVariant.get(job.variant.name) ?? []);
        done += 1;
        input.onProgress?.({ done, total: jobs.length, last: result });
        return result;
      })
    )
  );

  await pruneWorktrees(input.repoRoot);

  const experiment: ExperimentResult = {
    schemaVersion: 1,
    id: input.runId,
    startedAt: startedAt.toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    agent: input.config,
    trials: input.trials,
    variants: input.variants,
    tasks: input.tasks.map((task) => ({ id: task.id, file: task.file })),
    results
  };

  await writeFile(join(input.runDir, "results.json"), `${JSON.stringify(experiment, null, 2)}\n`);
  return experiment;
}
