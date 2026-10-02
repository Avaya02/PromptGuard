import { execa } from "execa";

import { promptRegistrySchema } from "@diditbreak/sdk";

export async function loadBaselinePrompts(
  cwd: string,
  baseRef: string
): Promise<Map<string, string>> {
  try {
    const { stdout } = await execa(
      "git",
      ["show", `${baseRef}:.diditbreak/prompts.json`],
      {
        cwd
      }
    );

    const registry = promptRegistrySchema.parse(JSON.parse(stdout));
    return new Map(registry.prompts.map((prompt) => [prompt.name, prompt.content]));
  } catch {
    return new Map();
  }
}
