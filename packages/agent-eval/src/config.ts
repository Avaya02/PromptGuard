import { z } from "zod";

import type { AgentConfig } from "./types.js";

export interface ExperimentSettings {
  agent: AgentConfig;
  tasksDir: string;
  trials: number;
  concurrency: number;
  /** Commands run in each sandbox before the agent starts. */
  setup: string[];
}

export const DEFAULT_SETTINGS: ExperimentSettings = {
  agent: {
    name: "claude-code",
    maxTurns: 30,
    maxBudgetUsd: 1,
    permissionMode: "acceptEdits",
    allowedTools: [],
    isolateMcp: true
  },
  tasksDir: ".diditbreak/tasks",
  trials: 3,
  // Agents are heavy: each holds a model session and may run builds and tests.
  concurrency: 2,
  setup: []
};

const settingsSchema = z
  .object({
    agent: z
      .object({
        name: z.enum(["claude-code", "mock"]).optional(),
        model: z.string().min(1).optional(),
        maxTurns: z.number().int().positive().optional(),
        maxBudgetUsd: z.number().positive().optional(),
        permissionMode: z.enum(["acceptEdits", "bypassPermissions", "dontAsk", "plan", "auto"]).optional(),
        allowedTools: z.array(z.string().min(1)).optional(),
        isolateMcp: z.boolean().optional()
      })
      .strict()
      .optional(),
    tasks: z
      .object({
        dir: z.string().min(1).optional(),
        trials: z.number().int().min(1).max(100).optional(),
        concurrency: z.number().int().min(1).max(32).optional(),
        setup: z.array(z.string().min(1)).optional()
      })
      .strict()
      .optional()
  })
  // Prompt-testing keys live in the same config file.
  .passthrough();

/** Reads the `agent` and `tasks` sections of diditbreak.config.ts, filling defaults. */
export function parseExperimentSettings(raw: unknown): ExperimentSettings {
  const parsed = settingsSchema.parse(raw ?? {});
  const agent = parsed.agent ?? {};
  const tasks = parsed.tasks ?? {};

  return {
    agent: {
      name: agent.name ?? DEFAULT_SETTINGS.agent.name,
      ...(agent.model !== undefined ? { model: agent.model } : {}),
      maxTurns: agent.maxTurns ?? DEFAULT_SETTINGS.agent.maxTurns,
      maxBudgetUsd: agent.maxBudgetUsd ?? DEFAULT_SETTINGS.agent.maxBudgetUsd,
      permissionMode: agent.permissionMode ?? DEFAULT_SETTINGS.agent.permissionMode,
      allowedTools: agent.allowedTools ?? DEFAULT_SETTINGS.agent.allowedTools,
      isolateMcp: agent.isolateMcp ?? DEFAULT_SETTINGS.agent.isolateMcp
    },
    tasksDir: tasks.dir ?? DEFAULT_SETTINGS.tasksDir,
    trials: tasks.trials ?? DEFAULT_SETTINGS.trials,
    concurrency: tasks.concurrency ?? DEFAULT_SETTINGS.concurrency,
    setup: tasks.setup ?? DEFAULT_SETTINGS.setup
  };
}
