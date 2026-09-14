import type { RegisteredPrompt } from "@promptguard/shared-types";
import { readPromptRegistry } from "@promptguard/sdk";

import { PromptGuardCliError } from "../errors.js";

export async function loadCurrentPrompts(cwd: string): Promise<RegisteredPrompt[]> {
  // readPromptRegistry already treats a missing registry as an empty one, so a
  // zero-length result covers both "never initialised" and "initialised but empty".
  const prompts = await readPromptRegistry({ cwd });

  if (prompts.length === 0) {
    throw new PromptGuardCliError(
      "No registered prompts found in .promptguard/prompts.json",
      "Run `prompt-guard init` to scaffold the project, then call definePrompt(name, content) from your app code to register a prompt."
    );
  }

  return prompts;
}
