import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { definePrompt } from "./define-prompt.js";
import { readPromptRegistry } from "./read-prompt-registry.js";
import { readRegistryFile, writeRegistryFile, DEFAULT_REGISTRY_PATH } from "./registry/storage.js";

let cwd: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "promptguard-sdk-"));
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

describe("definePrompt", () => {
  it("creates version 1 for a new prompt", async () => {
    const prompt = await definePrompt("greeter", "Say hello.", { cwd });

    expect(prompt.name).toBe("greeter");
    expect(prompt.version).toBe(1);
    expect(prompt.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(prompt.createdAt).toBe(prompt.updatedAt);
  });

  it("is idempotent when content is unchanged", async () => {
    const first = await definePrompt("greeter", "Say hello.", { cwd });
    const second = await definePrompt("greeter", "Say hello.", { cwd });

    // Re-registering identical content must not inflate the version number.
    expect(second.version).toBe(1);
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.updatedAt).toBe(first.updatedAt);
  });

  it("bumps the version when content changes", async () => {
    await definePrompt("greeter", "Say hello.", { cwd });
    const updated = await definePrompt("greeter", "Say hello warmly.", { cwd });

    expect(updated.version).toBe(2);

    const third = await definePrompt("greeter", "Say hello very warmly.", { cwd });
    expect(third.version).toBe(3);
  });

  it("preserves createdAt across version bumps", async () => {
    const first = await definePrompt("greeter", "v1", { cwd });
    const second = await definePrompt("greeter", "v2", { cwd });

    expect(second.createdAt).toBe(first.createdAt);
  });

  it("reverting to earlier content still bumps forward", async () => {
    await definePrompt("greeter", "original", { cwd });
    await definePrompt("greeter", "changed", { cwd });
    const reverted = await definePrompt("greeter", "original", { cwd });

    // Version is monotonic; it tracks change count, not content identity.
    expect(reverted.version).toBe(3);
  });

  it("keeps prompts independent and sorted by name", async () => {
    await definePrompt("zebra", "z", { cwd });
    await definePrompt("alpha", "a", { cwd });
    await definePrompt("zebra", "z2", { cwd });

    const prompts = await readPromptRegistry({ cwd });
    expect(prompts.map((p) => p.name)).toEqual(["alpha", "zebra"]);
    expect(prompts.find((p) => p.name === "alpha")?.version).toBe(1);
    expect(prompts.find((p) => p.name === "zebra")?.version).toBe(2);
  });

  it("rejects an empty name or empty content", async () => {
    await expect(definePrompt("", "content", { cwd })).rejects.toThrow();
    await expect(definePrompt("name", "", { cwd })).rejects.toThrow();
  });

  it("honours a custom registryPath", async () => {
    await definePrompt("custom", "content", { cwd, registryPath: "nested/dir/registry.json" });

    const raw = await readFile(join(cwd, "nested/dir/registry.json"), "utf-8");
    expect(JSON.parse(raw).prompts[0].name).toBe("custom");
  });
});

describe("registry serialisation", () => {
  it("round-trips through write and read", async () => {
    const path = join(cwd, DEFAULT_REGISTRY_PATH);
    const now = new Date().toISOString();
    const registry = {
      prompts: [
        { name: "a", content: "ca", hash: "h".repeat(64), version: 2, createdAt: now, updatedAt: now }
      ]
    };

    await writeRegistryFile(path, registry);
    expect(await readRegistryFile(path)).toEqual(registry);
  });

  it("writes human-readable JSON with a trailing newline", async () => {
    await definePrompt("greeter", "Say hello.", { cwd });

    const raw = await readFile(join(cwd, DEFAULT_REGISTRY_PATH), "utf-8");
    expect(raw.endsWith("\n")).toBe(true);
    // Two-space indentation keeps registry diffs reviewable in a PR.
    expect(raw).toContain('\n  "prompts"');
  });

  it("treats a missing registry as empty rather than throwing", async () => {
    expect(await readRegistryFile(join(cwd, "does/not/exist.json"))).toEqual({ prompts: [] });
    expect(await readPromptRegistry({ cwd })).toEqual([]);
  });

  it("rejects a structurally invalid registry", async () => {
    const path = join(cwd, DEFAULT_REGISTRY_PATH);
    await mkdir(join(cwd, ".promptguard"), { recursive: true });
    await writeFile(path, JSON.stringify({ prompts: [{ name: "x" }] }), "utf-8");

    await expect(readRegistryFile(path)).rejects.toThrow();
  });

  it("rejects a non-positive version", async () => {
    const path = join(cwd, DEFAULT_REGISTRY_PATH);
    await mkdir(join(cwd, ".promptguard"), { recursive: true });
    const now = new Date().toISOString();
    await writeFile(
      path,
      JSON.stringify({
        prompts: [{ name: "x", content: "c", hash: "h", version: 0, createdAt: now, updatedAt: now }]
      }),
      "utf-8"
    );

    await expect(readRegistryFile(path)).rejects.toThrow();
  });
});
