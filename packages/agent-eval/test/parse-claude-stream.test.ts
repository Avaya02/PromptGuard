import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { parseClaudeStream } from "../src/agents/parse-claude-stream.js";

// A real `claude -p --output-format stream-json` transcript (paths and
// connector names scrubbed): a skill-triggering task on Claude Code 2.1.202.
const realRun = readFileSync(new URL("./fixtures/claude-skill-run.jsonl", import.meta.url), "utf-8");

describe("parseClaudeStream on a real transcript", () => {
  const result = parseClaudeStream(realRun);

  it("reads completion, turns, duration and cost from the result event", () => {
    expect(result.completed).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.turns).toBe(4);
    expect(result.durationMs).toBe(8620);
    expect(result.costUsd).toBeCloseTo(0.0861761, 6);
  });

  it("detects the skill invocation", () => {
    expect(result.skillsUsed).toEqual(["haiku-writer"]);
  });

  it("records every tool call once, in order", () => {
    expect(result.toolCalls.map((call) => call.name)).toEqual(["Skill", "Write"]);
  });

  it("measures the context carried into the first model call", () => {
    // 10 fresh + 18,635 cache-write tokens, before the agent did anything.
    expect(result.contextTokens).toBe(18645);
  });

  it("counts total input including cache reads and writes", () => {
    expect(result.inputTokens).toBe(28 + 39854 + 19531);
    expect(result.outputTokens).toBe(778);
  });

  it("captures the environment the agent reported", () => {
    expect(result.environment.version).toBe("2.1.202");
    expect(result.environment.model).toBe("claude-haiku-4-5-20251001");
    expect(result.environment.skillsLoaded).toContain("haiku-writer");
    expect(result.environment.mcpServers).toEqual(["example-connector"]);
  });
});

function event(value: unknown): string {
  return JSON.stringify(value);
}

describe("parseClaudeStream edge cases", () => {
  it("reports a crash when there is no result event", () => {
    const result = parseClaudeStream(
      [
        event({ type: "system", subtype: "init", skills: [] }),
        event({ type: "assistant", message: { id: "m1", content: [{ type: "text", text: "working" }] } })
      ].join("\n")
    );

    expect(result.completed).toBe(false);
    expect(result.error).toMatch(/without a result/);
    expect(result.finalMessage).toBe("working");
  });

  it("names the limit that stopped the agent", () => {
    const result = parseClaudeStream(
      event({ type: "result", subtype: "error_max_turns", is_error: true, num_turns: 30, total_cost_usd: 0.5 })
    );

    expect(result.completed).toBe(false);
    expect(result.error).toBe("error_max_turns");
    expect(result.turns).toBe(30);
  });

  it("de-duplicates content blocks repeated across streamed events", () => {
    const toolUse = { type: "tool_use", id: "t1", name: "Bash", input: { command: "pnpm test" } };
    const result = parseClaudeStream(
      [
        event({ type: "assistant", message: { id: "m1", content: [toolUse] } }),
        event({ type: "assistant", message: { id: "m1", content: [toolUse] } }),
        event({ type: "result", subtype: "success", num_turns: 1 })
      ].join("\n")
    );

    expect(result.commands).toEqual(["pnpm test"]);
  });

  it("tolerates a truncated last line from a killed process", () => {
    const result = parseClaudeStream(
      `${event({ type: "result", subtype: "success", num_turns: 2 })}\n{"type":"assist`
    );
    expect(result.completed).toBe(true);
  });

  it("counts permission denials, which usually mean allowedTools is too narrow", () => {
    const result = parseClaudeStream(
      event({ type: "result", subtype: "success", permission_denials: [{ tool: "Bash" }, { tool: "Bash" }] })
    );
    expect(result.permissionDenials).toBe(2);
  });

  it("returns empty values for empty input", () => {
    const result = parseClaudeStream("");
    expect(result.completed).toBe(false);
    expect(result.toolCalls).toEqual([]);
    expect(result.contextTokens).toBeNull();
  });
});
