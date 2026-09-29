import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { PromptRegistry } from "./schema.js";
import { promptRegistrySchema } from "./schema.js";

export const DEFAULT_REGISTRY_PATH = ".promptguard/prompts.json";

export async function readRegistryFile(registryPath: string): Promise<PromptRegistry> {
  try {
    const raw = await readFile(registryPath, "utf-8");
    return promptRegistrySchema.parse(JSON.parse(raw));
  } catch (error) {
    if (isFileNotFound(error)) {
      return { prompts: [] };
    }

    throw error;
  }
}

export async function writeRegistryFile(
  registryPath: string,
  registry: PromptRegistry
): Promise<void> {
  await mkdir(dirname(registryPath), { recursive: true });
  await writeFile(registryPath, JSON.stringify(registry, null, 2) + "\n", "utf-8");
}

function isFileNotFound(error: unknown): error is NodeJS.ErrnoException {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof (error as NodeJS.ErrnoException).code === "string" &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
