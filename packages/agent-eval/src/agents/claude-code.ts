import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { AgentAdapter, AgentRunInput, AgentRunResult } from "../types.js";
import { parseClaudeStream } from "./parse-claude-stream.js";

/** An empty MCP config; with --strict-mcp-config it shuts out personal servers. */
const NO_MCP_SERVERS = JSON.stringify({ mcpServers: {} });

export function buildClaudeArgs(input: AgentRunInput): string[] {
  const { config } = input;
  const args = [
    "-p",
    input.prompt,
    "--output-format",
    "stream-json",
    "--verbose",
    // Experiments must not litter the user's session history or be resumable.
    "--no-session-persistence",
    // Project settings only: personal hooks, permissions and env from
    // ~/.claude/settings.json would otherwise change behaviour per machine.
    "--setting-sources",
    "project",
    "--max-turns",
    String(config.maxTurns),
    "--max-budget-usd",
    String(config.maxBudgetUsd),
    "--permission-mode",
    config.permissionMode
  ];

  if (config.model !== undefined) {
    args.push("--model", config.model);
  }

  if (config.allowedTools.length > 0) {
    args.push("--allowedTools", ...config.allowedTools);
  }

  if (config.isolateMcp) {
    args.push("--strict-mcp-config", "--mcp-config", NO_MCP_SERVERS);
  }

  return args;
}

/**
 * Environment for the child agent. Claude Code refuses to start inside another
 * Claude Code session, and diditbreak itself is often run from one.
 */
export function childEnvironment(parent: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...parent };
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  return env;
}

export class ClaudeCodeAdapter implements AgentAdapter {
  readonly name = "claude-code" as const;
  private readonly binary: string;

  constructor(binary = process.env.DIDITBREAK_CLAUDE_BIN ?? "claude") {
    this.binary = binary;
  }

  async run(input: AgentRunInput): Promise<AgentRunResult> {
    await mkdir(dirname(input.transcriptPath), { recursive: true });
    const transcript = createWriteStream(input.transcriptPath);
    const started = Date.now();

    const outcome = await new Promise<{ code: number | null; timedOut: boolean; spawnError?: string; stderr: string }>(
      (resolvePromise) => {
        const child = spawn(this.binary, buildClaudeArgs(input), {
          cwd: input.cwd,
          env: childEnvironment(process.env),
          // Closed stdin: an open pipe makes headless Claude wait for input.
          stdio: ["ignore", "pipe", "pipe"],
          detached: true
        });

        let stderr = "";
        child.stdout.pipe(transcript);
        child.stderr.on("data", (chunk: Buffer) => {
          stderr = (stderr + chunk.toString("utf-8")).slice(-4000);
        });

        let timedOut = false;
        const timer = setTimeout(() => {
          timedOut = true;
          try {
            process.kill(-child.pid!, "SIGKILL");
          } catch {
            child.kill("SIGKILL");
          }
        }, input.timeoutMs);

        child.on("error", (error) => {
          clearTimeout(timer);
          resolvePromise({ code: null, timedOut: false, spawnError: error.message, stderr });
        });

        child.on("close", (code) => {
          clearTimeout(timer);
          resolvePromise({ code, timedOut, stderr });
        });
      }
    );

    await new Promise<void>((resolvePromise) => transcript.end(resolvePromise));

    if (outcome.spawnError) {
      const notFound = /ENOENT/.test(outcome.spawnError);
      return failure(
        notFound
          ? `"${this.binary}" not found. Install Claude Code, or set DIDITBREAK_CLAUDE_BIN.`
          : outcome.spawnError,
        Date.now() - started
      );
    }

    const parsed = parseClaudeStream(await readFile(input.transcriptPath, "utf-8").catch(() => ""));

    if (outcome.timedOut) {
      return {
        ...parsed,
        completed: false,
        error: `timed out after ${Math.round(input.timeoutMs / 1000)}s`,
        durationMs: Date.now() - started
      };
    }

    if (!parsed.completed && parsed.error?.startsWith("the agent exited") && outcome.stderr.trim()) {
      return { ...parsed, error: `${parsed.error}: ${outcome.stderr.trim().split("\n").slice(-3).join(" ")}` };
    }

    return { ...parsed, durationMs: parsed.durationMs || Date.now() - started };
  }
}

function failure(error: string, durationMs: number): AgentRunResult {
  return {
    completed: false,
    error,
    finalMessage: "",
    turns: 0,
    durationMs,
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
