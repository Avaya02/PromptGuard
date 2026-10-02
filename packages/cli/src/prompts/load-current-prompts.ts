import type { RegisteredPrompt } from "@diditbreak/shared-types";
import { readPromptRegistry } from "@diditbreak/sdk";

import { CliError } from "../errors.js";

export async function loadCurrentPrompts(cwd: string): Promise<RegisteredPrompt[]> {
  // readPromptRegistry already treats a missing registry as an empty one, so a
  // zero-length result covers both "never initialised" and "initialised but empty".
  const prompts = await readPromptRegistry({ cwd });

  if (prompts.length === 0) {
    throw new CliError(
      "No prompts registered yet.",
      "Register one with `diditbreak add <name> <file>` (or definePrompt() in code). New project? `diditbreak init` scaffolds a working example."
    );
  }

  return prompts;
}
