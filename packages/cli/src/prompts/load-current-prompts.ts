import type { RegisteredPrompt } from "@promptguard/shared-types";
import { readPromptRegistry } from "@promptguard/sdk";

import { PromptGuardCliError } from "../errors.js";

export async function loadCurrentPrompts(cwd: string): Promise<RegisteredPrompt[]> {
  // readPromptRegistry already treats a missing registry as an empty one, so a
  // zero-length result covers both "never initialised" and "initialised but empty".
  const prompts = await readPromptRegistry({ cwd });

  if (prompts.length === 0) {
    throw new PromptGuardCliError(
      "No prompts registered yet.",
      "Register one with `promptguard add <name> <file>` (or definePrompt() in code). New project? `promptguard init` scaffolds a working example."
    );
  }

  return prompts;
}
