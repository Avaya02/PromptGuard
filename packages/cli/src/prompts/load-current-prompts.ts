import type { RegisteredPrompt } from "@promptguard/shared-types";
import { readPromptRegistry } from "@promptguard/sdk";

export async function loadCurrentPrompts(cwd: string): Promise<RegisteredPrompt[]> {
  const prompts = await readPromptRegistry({ cwd });
  if (prompts.length === 0) {
    throw new Error("No registered prompts found. Run definePrompt() before testing.");
  }

  return prompts;
}
