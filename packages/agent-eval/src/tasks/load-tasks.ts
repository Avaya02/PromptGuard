import { readFile, readdir } from "node:fs/promises";
import { basename, extname, relative, resolve } from "node:path";

import { parse as parseYaml } from "yaml";
import { z } from "zod";

import type { AgentTask } from "../types.js";

const listOf = z.union([z.string().min(1), z.array(z.string().min(1))]).transform((value) =>
  Array.isArray(value) ? value : [value]
);

// Task files are written by hand, so keys are snake_case and unknown keys are
// rejected: a typo like `must_chnage` must fail loudly, not silently pass.
const checksSchema = z
  .object({
    must_change: listOf.optional(),
    must_not_change: listOf.optional(),
    forbid_commands: listOf.optional(),
    expect_skills: listOf.optional(),
    forbid_skills: listOf.optional(),
    max_turns: z.number().int().positive().optional(),
    max_cost_usd: z.number().positive().optional()
  })
  .strict();

const mockSchema = z
  .object({
    files: z.record(z.string()).optional(),
    requires: listOf.optional(),
    breaks_on: listOf.optional(),
    flaky: z.number().min(0).max(1).optional(),
    commands: z
      .array(
        z.union([
          z.string().min(1).transform((run) => ({ run, when: undefined, unless: undefined })),
          z
            .object({
              run: z.string().min(1),
              when: z.string().min(1).optional(),
              unless: z.string().min(1).optional()
            })
            .strict()
        ])
      )
      .optional(),
    skills: listOf.optional()
  })
  .strict();

const taskSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-_.]*$/i, "use letters, digits, - _ .").optional(),
    prompt: z.string().min(1),
    base: z.string().min(1).optional(),
    verify: listOf.optional(),
    checks: checksSchema.optional(),
    timeout: z.number().int().positive().optional(),
    mock: mockSchema.optional()
  })
  .strict();

export class TaskFileError extends Error {
  readonly file: string;

  constructor(file: string, message: string) {
    super(`${file}: ${message}`);
    this.name = "TaskFileError";
    this.file = file;
  }
}

const DEFAULT_TIMEOUT_SEC = 600;

export function parseTask(raw: unknown, file: string): AgentTask {
  const result = taskSchema.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue && issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
    throw new TaskFileError(file, `${where}${issue?.message ?? "invalid task"}`);
  }

  const task = result.data;
  const checks = task.checks ?? {};
  const id = task.id ?? basename(file, extname(file));

  if (task.verify === undefined && task.checks === undefined && task.mock === undefined) {
    throw new TaskFileError(
      file,
      "a task needs `verify` commands or `checks`, otherwise nothing decides whether it passed"
    );
  }

  return {
    id,
    prompt: task.prompt.trim(),
    base: task.base ?? "HEAD",
    verify: task.verify ?? [],
    checks: {
      mustChange: checks.must_change ?? [],
      mustNotChange: checks.must_not_change ?? [],
      forbidCommands: checks.forbid_commands ?? [],
      expectSkills: checks.expect_skills ?? [],
      forbidSkills: checks.forbid_skills ?? [],
      ...(checks.max_turns !== undefined ? { maxTurns: checks.max_turns } : {}),
      ...(checks.max_cost_usd !== undefined ? { maxCostUsd: checks.max_cost_usd } : {})
    },
    timeoutSec: task.timeout ?? DEFAULT_TIMEOUT_SEC,
    ...(task.mock !== undefined
      ? {
          mock: {
            files: task.mock.files ?? {},
            requires: task.mock.requires ?? [],
            breaksOn: task.mock.breaks_on ?? [],
            flaky: task.mock.flaky ?? 0,
            commands: task.mock.commands ?? [],
            skills: task.mock.skills ?? []
          }
        }
      : {}),
    file
  };
}

/** Loads every *.yaml / *.yml task in a directory, sorted for stable ordering. */
export async function loadTasks(cwd: string, tasksDir: string): Promise<AgentTask[]> {
  const dir = resolve(cwd, tasksDir);
  let entries: string[];

  try {
    entries = await readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new TaskFileError(relative(cwd, dir) || dir, "task directory not found");
    }
    throw error;
  }

  const files = entries.filter((name) => /\.ya?ml$/.test(name)).sort();
  const tasks: AgentTask[] = [];

  for (const name of files) {
    const path = resolve(dir, name);
    const display = relative(cwd, path);
    let raw: unknown;

    try {
      raw = parseYaml(await readFile(path, "utf-8"));
    } catch (error) {
      throw new TaskFileError(display, `invalid YAML: ${(error as Error).message}`);
    }

    tasks.push(parseTask(raw, display));
  }

  const seen = new Set<string>();
  for (const task of tasks) {
    if (seen.has(task.id)) {
      throw new TaskFileError(task.file, `duplicate task id "${task.id}"`);
    }
    seen.add(task.id);
  }

  return tasks;
}
