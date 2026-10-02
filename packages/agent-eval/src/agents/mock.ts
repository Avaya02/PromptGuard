import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { AgentAdapter, AgentRunInput, AgentRunResult, ToolCall } from "../types.js";

/** Same deterministic PRNG the mock LLM provider uses, so runs reproduce. */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}

// Roughly what Claude Code carries before reading a task (measured at ~18.6k
// tokens in a real run), plus ~4 characters per token of context.
const BASE_CONTEXT_TOKENS = 18_000;
const CHARS_PER_TOKEN = 4;
const USD_PER_MILLION_INPUT = 1;

/**
 * Scripted stand-in for a coding agent, used by tests, CI and free demos.
 *
 * It models the effects an experiment is meant to detect, in a reproducible
 * way: more context means more tokens and turns; an instruction listed in
 * `breaks_on` confuses it into failing; a skill only fires when its directory
 * is present. It is a simulation and its numbers are not real measurements.
 */
export class MockAgentAdapter implements AgentAdapter {
  readonly name = "mock" as const;

  async run(input: AgentRunInput): Promise<AgentRunResult> {
    const script = input.mock;
    const contextChars = input.context.text.length;
    const contextTokens = BASE_CONTEXT_TOKENS + Math.round(contextChars / CHARS_PER_TOKEN);
    const turns = 3 + Math.floor(contextChars / 1500);

    const random = createRandom(hash(`${input.prompt}|${input.context.text}|${input.trial}`));
    const toolCalls: ToolCall[] = [];
    const skillsUsed: string[] = [];
    const commands: string[] = [];

    const missing = script?.requires.filter((needle) => !input.context.text.includes(needle)) ?? [];
    const confusedBy = script?.breaksOn.filter((needle) => input.context.text.includes(needle)) ?? [];
    const unlucky = script !== undefined && random() < script.flaky;
    const solves = script !== undefined && missing.length === 0 && confusedBy.length === 0 && !unlucky;

    for (const skill of script?.skills ?? []) {
      const available = input.context.paths.some((path) => path.startsWith(`.claude/skills/${skill}/`));
      if (available) {
        skillsUsed.push(skill);
        toolCalls.push({ name: "Skill", input: { skill } });
      }
    }

    for (const command of script?.commands ?? []) {
      if (command.when !== undefined && !input.context.text.includes(command.when)) {
        continue;
      }
      if (command.unless !== undefined && input.context.text.includes(command.unless)) {
        continue;
      }
      commands.push(command.run);
      toolCalls.push({ name: "Bash", input: { command: command.run } });
    }

    if (solves) {
      for (const [path, content] of Object.entries(script.files)) {
        const target = join(input.cwd, path);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, content);
        toolCalls.push({ name: "Write", input: { file_path: path } });
      }
    }

    const inputTokens = contextTokens * turns;
    const result: AgentRunResult = {
      completed: true,
      finalMessage: solves
        ? "Done."
        : script === undefined
          ? "No mock script for this task; did nothing."
          : confusedBy.length > 0
            ? `Got confused by: ${confusedBy.join(", ")}`
            : missing.length > 0
              ? `Missing context: ${missing.join(", ")}`
              : "Failed this attempt.",
      turns,
      durationMs: 400 + turns * 150,
      costUsd: Number(((inputTokens / 1_000_000) * USD_PER_MILLION_INPUT).toFixed(6)),
      inputTokens,
      outputTokens: 200 * turns,
      contextTokens,
      toolCalls,
      skillsUsed,
      commands,
      permissionDenials: 0,
      environment: {
        model: "mock",
        version: "mock",
        skillsLoaded: input.context.paths
          .filter((path) => /^\.claude\/skills\/[^/]+\/SKILL\.md$/.test(path))
          .map((path) => path.split("/")[2]!),
        mcpServers: [],
        agents: []
      }
    };

    await mkdir(dirname(input.transcriptPath), { recursive: true });
    await writeFile(input.transcriptPath, `${JSON.stringify({ type: "mock-result", ...result })}\n`);

    return result;
  }
}
