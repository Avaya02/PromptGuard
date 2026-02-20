import { resolve } from "node:path";

import type { RegisteredPrompt } from "@promptguard/shared-types";
import { z } from "zod";

import { hashPrompt } from "./registry/hash.js";
import { DEFAULT_REGISTRY_PATH, readRegistryFile, writeRegistryFile } from "./registry/storage.js";

const definePromptArgsSchema = z.object({
  name: z.string().min(1, "Prompt name is required."),
  content: z.string().min(1, "Prompt content is required.")
});

export interface DefinePromptOptions {
  cwd?: string;
  registryPath?: string;
}

export async function definePrompt(
  name: string,
  content: string,
  options: DefinePromptOptions = {}
): Promise<RegisteredPrompt> {
  const parsed = definePromptArgsSchema.parse({ name, content });
  const registryPath = resolve(options.cwd ?? process.cwd(), options.registryPath ?? DEFAULT_REGISTRY_PATH);

  const registry = await readRegistryFile(registryPath);
  const existing = registry.prompts.find((prompt) => prompt.name === parsed.name);
  const hash = hashPrompt(parsed.content);

  if (existing && existing.hash === hash) {
    return existing;
  }

  const now = new Date().toISOString();
  const updated: RegisteredPrompt = {
    name: parsed.name,
    content: parsed.content,
    hash,
    version: existing ? existing.version + 1 : 1,
    createdAt: existing ? existing.createdAt : now,
    updatedAt: now
  };

  const nextPrompts = registry.prompts
    .filter((prompt) => prompt.name !== parsed.name)
    .concat(updated)
    .sort((a, b) => a.name.localeCompare(b.name));

  await writeRegistryFile(registryPath, { prompts: nextPrompts });

  return updated;
}
