import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ClaudeCodeAdapter } from "../src/agents/claude-code.js";
import { DEFAULT_SETTINGS } from "../src/config.js";
import type { AgentRunInput } from "../src/types.js";

let dir: string;
const fixture = fileURLToPath(new URL("./fixtures/claude-skill-run.jsonl", import.meta.url));

async function fakeBinary(name: string, script: string): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, `#!/bin/sh\n${script}\n`);
  await chmod(path, 0o755);
  return path;
}

function input(overrides: Partial<AgentRunInput> = {}): AgentRunInput {
  return {
    cwd: dir,
    prompt: "Write a haiku",
    config: DEFAULT_SETTINGS.agent,
    timeoutMs: 10_000,
    transcriptPath: join(dir, "out", "transcript.jsonl"),
    trial: 1,
    context: { paths: [], text: "" },
    ...overrides
  };
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "diditbreak-claude-"));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("ClaudeCodeAdapter", () => {
  it("streams the transcript to disk and parses it", async () => {
    const binary = await fakeBinary("claude-ok", `cat "${fixture}"`);
    const result = await new ClaudeCodeAdapter(binary).run(input());

    expect(result.completed).toBe(true);
    expect(result.skillsUsed).toEqual(["haiku-writer"]);
    expect(await readFile(join(dir, "out", "transcript.jsonl"), "utf-8")).toContain('"type":"result"');
  });

  it("passes the headless flags and strips nesting variables", async () => {
    const binary = await fakeBinary(
      "claude-echo",
      `printf '%s\\n' "$@" > "${dir}/args.txt"; env > "${dir}/env.txt"; cat "${fixture}"`
    );
    process.env.CLAUDECODE = "1";
    try {
      await new ClaudeCodeAdapter(binary).run(input());
    } finally {
      delete process.env.CLAUDECODE;
    }

    const args = (await readFile(join(dir, "args.txt"), "utf-8")).split("\n");
    expect(args[0]).toBe("-p");
    expect(args[1]).toBe("Write a haiku");
    expect(args).toContain("--no-session-persistence");
    expect(await readFile(join(dir, "env.txt"), "utf-8")).not.toMatch(/^CLAUDECODE=/m);
  });

  it("kills a run that exceeds its timeout", async () => {
    const binary = await fakeBinary("claude-hang", "sleep 30");
    const started = Date.now();
    const result = await new ClaudeCodeAdapter(binary).run(input({ timeoutMs: 300 }));

    expect(result.completed).toBe(false);
    expect(result.error).toMatch(/timed out/);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it("explains a missing binary instead of crashing", async () => {
    const result = await new ClaudeCodeAdapter(join(dir, "does-not-exist")).run(input());
    expect(result.completed).toBe(false);
    expect(result.error).toMatch(/not found.*DIDITBREAK_CLAUDE_BIN/);
  });

  it("surfaces stderr when the agent dies without a result", async () => {
    const binary = await fakeBinary("claude-crash", 'echo "Error: invalid API key" >&2; exit 1');
    const result = await new ClaudeCodeAdapter(binary).run(input());
    expect(result.error).toMatch(/invalid API key/);
  });
});
