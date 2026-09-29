import { resolve } from "node:path";

import type { RegisteredPrompt } from "@promptguard/shared-types";

import { DEFAULT_REGISTRY_PATH, readRegistryFile } from "./registry/storage.js";

export interface ReadPromptRegistryOptions {
  cwd?: string;
  registryPath?: string;
}

export async function readPromptRegistry(
  options: ReadPromptRegistryOptions = {}
): Promise<RegisteredPrompt[]> {
  const registryPath = resolve(options.cwd ?? process.cwd(), options.registryPath ?? DEFAULT_REGISTRY_PATH);
  const registry = await readRegistryFile(registryPath);
  return registry.prompts;
}
