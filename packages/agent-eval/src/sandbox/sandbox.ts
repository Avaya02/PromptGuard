import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import type { ContextFile } from "../context/context-files.js";
import { isContextPath, removeSection } from "../context/context-files.js";
import { git, gitCommitAll, splitNul } from "../context/git.js";
import type { AgentTask, Variant } from "../types.js";
import { runShell } from "./shell.js";

export class SandboxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SandboxError";
  }
}

export interface Sandbox {
  dir: string;
  /** Context paths present after the variant was applied. */
  contextPaths: string[];
  /** Concatenated text of those files; the mock agent reasons over it. */
  contextText: string;
  cleanup(): Promise<void>;
}

export interface CreateSandboxInput {
  repoRoot: string;
  runId: string;
  task: AgentTask;
  variant: Variant;
  trial: number;
  contextFiles: ContextFile[];
  /** Commands run once before the agent starts, e.g. installing dependencies. */
  setup: string[];
  setupTimeoutMs: number;
}

// `git worktree add/remove` take repository-wide locks; parallel calls can fail
// with "could not lock". Agents still run concurrently: only these brief git
// operations are serialised, per repository.
const worktreeLocks = new Map<string, Promise<unknown>>();

function withWorktreeLock<T>(repo: string, operation: () => Promise<T>): Promise<T> {
  const previous = worktreeLocks.get(repo) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(operation);
  worktreeLocks.set(repo, next);
  return next;
}

/** File-system-safe form of a variant or task name, used for every path built from one. */
export function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 60);
}

/** Resolves a repo-relative path inside the sandbox, refusing to escape it. */
function within(root: string, path: string): string {
  const target = resolve(root, path);
  const rel = relative(root, target);
  // The root itself is refused too: "remove ''" must never mean "remove everything".
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new SandboxError(`path "${path}" resolves outside the sandbox`);
  }
  return target;
}

/**
 * Builds an isolated copy of the repository for one trial.
 *
 * The code comes from the task's base commit; the context files are replaced
 * with the variant's. Both states are committed, so after the agent runs,
 * `git diff HEAD` contains exactly what the agent changed and nothing else.
 *
 * Every trial gets a unique path, which matters beyond tidiness: agents key
 * per-project state (such as Claude Code's auto memory) on the directory, so a
 * shared path would let one trial's memories leak into the next.
 */
export async function createSandbox(input: CreateSandboxInput): Promise<Sandbox> {
  const dir = join(
    tmpdir(),
    "diditbreak",
    safeSegment(input.runId),
    `${safeSegment(input.variant.name)}--${safeSegment(input.task.id)}--${input.trial}`
  );

  await rm(dir, { recursive: true, force: true });
  await mkdir(dirname(dir), { recursive: true });

  try {
    await withWorktreeLock(input.repoRoot, () =>
      git(["worktree", "add", "--detach", "--quiet", dir, input.task.base], input.repoRoot)
    );
  } catch (error) {
    throw new SandboxError(
      `could not check out "${input.task.base}" for task ${input.task.id}: ${(error as Error).message}`
    );
  }

  const cleanup = async (): Promise<void> => {
    await withWorktreeLock(input.repoRoot, () =>
      git(["worktree", "remove", "--force", dir], input.repoRoot)
    ).catch(() => undefined);
    await rm(dir, { recursive: true, force: true });
  };

  try {
    // 1. Strip whatever context the base commit carried.
    const tracked = splitNul(await git(["ls-files", "-z"], dir)).filter(isContextPath);
    await Promise.all(tracked.map((path) => rm(within(dir, path), { recursive: true, force: true })));

    // 2. Lay down the variant's context.
    for (const file of input.contextFiles) {
      const target = within(dir, file.path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, file.content);
    }

    // 3. Apply ablations.
    for (const path of input.variant.remove) {
      await rm(within(dir, path), { recursive: true, force: true });
    }

    for (const removal of input.variant.removeSections) {
      const target = within(dir, removal.file);
      const original = await readFile(target, "utf-8").catch(() => null);
      if (original === null) {
        throw new SandboxError(`cannot remove a section from ${removal.file}: the file is not in this variant`);
      }
      const { text, removed } = removeSection(original, removal.heading);
      if (!removed) {
        throw new SandboxError(`no section "${removal.heading}" in ${removal.file}`);
      }
      await writeFile(target, text);
    }

    await gitCommitAll(dir, `diditbreak: context for ${input.variant.name}`);

    // 4. Project setup, then commit again so setup output never shows up as
    //    the agent's work.
    for (const command of input.setup) {
      const result = await runShell(command, dir, input.setupTimeoutMs);
      if (result.exitCode !== 0) {
        throw new SandboxError(`setup command failed (exit ${result.exitCode}): ${command}\n${result.output}`);
      }
    }
    if (input.setup.length > 0) {
      await gitCommitAll(dir, "diditbreak: setup");
    }

    const present = splitNul(await git(["ls-files", "-z"], dir)).filter(isContextPath).sort();
    const texts = await Promise.all(
      present.map(async (path) => `--- ${path}\n${await readFile(join(dir, path), "utf-8").catch(() => "")}`)
    );

    return { dir, contextPaths: present, contextText: texts.join("\n"), cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

export interface SandboxChanges {
  files: string[];
  patch: string;
}

/** Everything the agent changed since the sandbox was prepared. */
export async function collectChanges(dir: string): Promise<SandboxChanges> {
  await git(["add", "-A"], dir);
  const files = splitNul(await git(["diff", "--cached", "--name-only", "-z", "HEAD"], dir)).sort();
  const patch = await git(["diff", "--cached", "--binary", "HEAD"], dir);
  return { files, patch };
}

/** Clears worktree records left by a crashed run, so `git worktree list` stays clean. */
export async function pruneWorktrees(repoRoot: string): Promise<void> {
  await withWorktreeLock(repoRoot, () => git(["worktree", "prune"], repoRoot)).catch(() => undefined);
}
