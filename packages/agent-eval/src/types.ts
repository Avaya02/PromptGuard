/**
 * Core vocabulary for agent context experiments.
 *
 * An experiment runs the same TASKS against several VARIANTS of the agent's
 * context (CLAUDE.md, AGENTS.md, skills, MCP config), several TRIALS each,
 * because agents are non-deterministic and one run proves nothing.
 */

export type AgentName = "claude-code" | "mock";

export type PermissionMode = "acceptEdits" | "bypassPermissions" | "dontAsk" | "plan" | "auto";

export interface AgentConfig {
  name: AgentName;
  /** Model alias or id passed to the agent, e.g. "sonnet". Agent default when unset. */
  model?: string | undefined;
  maxTurns: number;
  /** Hard spend cap per run, enforced by the agent itself. */
  maxBudgetUsd: number;
  permissionMode: PermissionMode;
  /** Tools the agent may use without asking, e.g. "Bash(pnpm test:*)". */
  allowedTools: string[];
  /**
   * Keep personal MCP servers out of the run. Results should describe the
   * repository's setup, not whichever connectors the person running it has.
   */
  isolateMcp: boolean;
}

/** Where a variant's context files come from. */
export type ContextSource =
  | { kind: "working" }
  | { kind: "ref"; ref: string }
  | { kind: "none" };

export interface SectionRemoval {
  /** Markdown file relative to the repo root, e.g. "CLAUDE.md". */
  file: string;
  /** Heading text of the section to drop, matched case-insensitively. */
  heading: string;
}

export interface Variant {
  name: string;
  context: ContextSource;
  /** Paths removed after the context is laid down, e.g. ".claude/skills/pdf". */
  remove: string[];
  /** Markdown sections removed, used by ablation. */
  removeSections: SectionRemoval[];
  /** Per-variant model override, so models can be compared the same way. */
  model?: string | undefined;
}

export interface TaskChecks {
  /** Each path must appear in the agent's diff. */
  mustChange: string[];
  /** No path here may appear in the agent's diff. */
  mustNotChange: string[];
  /** Substrings that must not appear in any shell command the agent ran. */
  forbidCommands: string[];
  /** Skills the agent is expected to invoke. */
  expectSkills: string[];
  /** Skills the agent must not invoke on this task. */
  forbidSkills: string[];
  maxTurns?: number | undefined;
  maxCostUsd?: number | undefined;
}

/** Scripted behaviour for the mock agent, used by tests, CI and free demos. */
export interface MockScript {
  /** Files written when the mock "solves" the task. */
  files: Record<string, string>;
  /** Every string must appear somewhere in the context for the mock to succeed. */
  requires: string[];
  /** Any string present in the context makes the mock fail, as a confused agent would. */
  breaksOn: string[];
  /** Probability (0..1) of failing anyway; seeded per trial so runs reproduce. */
  flaky: number;
  /**
   * Shell commands recorded as tool calls. `when` runs one only if the context
   * contains that text (an instruction the agent follows); `unless` skips it
   * if the context contains that text (a rule that prevents it).
   */
  commands: Array<{ run: string; when?: string | undefined; unless?: string | undefined }>;
  /** Skills invoked when their directory exists in the context. */
  skills: string[];
}

export interface AgentTask {
  id: string;
  /** The instruction given to the agent, verbatim. */
  prompt: string;
  /** Git ref the code starts from. Context files are replaced per variant. */
  base: string;
  /** Shell commands that must all exit 0 after the agent finishes. */
  verify: string[];
  checks: TaskChecks;
  timeoutSec: number;
  mock?: MockScript | undefined;
  /** Source file, for error messages. */
  file: string;
}

export interface ToolCall {
  name: string;
  input: Record<string, unknown>;
}

/** What the agent reported about its own environment at startup. */
export interface AgentEnvironment {
  model?: string | undefined;
  version?: string | undefined;
  skillsLoaded: string[];
  mcpServers: string[];
  agents: string[];
}

export interface AgentRunResult {
  /** False when the agent crashed, timed out, or hit a turn or budget limit. */
  completed: boolean;
  error?: string | undefined;
  finalMessage: string;
  turns: number;
  durationMs: number;
  costUsd: number | null;
  inputTokens: number;
  outputTokens: number;
  /**
   * Prompt size of the first model call: everything the agent carried before
   * doing any work (system prompt, tools, skill descriptions, CLAUDE.md).
   */
  contextTokens: number | null;
  toolCalls: ToolCall[];
  skillsUsed: string[];
  commands: string[];
  permissionDenials: number;
  environment: AgentEnvironment;
}

export interface AgentRunInput {
  cwd: string;
  prompt: string;
  config: AgentConfig;
  timeoutMs: number;
  transcriptPath: string;
  trial: number;
  /** Context the variant laid down, for the mock agent's decisions. */
  context: { paths: string[]; text: string };
  mock?: MockScript | undefined;
}

export interface AgentAdapter {
  readonly name: AgentName;
  run(input: AgentRunInput): Promise<AgentRunResult>;
}

export interface CheckOutcome {
  check: string;
  pass: boolean;
  detail: string;
}

export interface VerifyOutcome {
  command: string;
  exitCode: number;
  /** Tail of combined output, enough to see why it failed. */
  output: string;
}

export type FailureReason = "agent-error" | "verify-failed" | "check-failed" | null;

export interface TrialResult {
  variant: string;
  taskId: string;
  trial: number;
  passed: boolean;
  failure: FailureReason;
  verify: VerifyOutcome[];
  checks: CheckOutcome[];
  agent: AgentRunResult;
  changedFiles: string[];
  /** Paths relative to the run directory. */
  diffPath: string;
  transcriptPath: string;
}

export interface ExperimentResult {
  schemaVersion: 1;
  id: string;
  startedAt: string;
  durationMs: number;
  agent: AgentConfig;
  trials: number;
  variants: Variant[];
  tasks: Array<{ id: string; file: string }>;
  results: TrialResult[];
}
