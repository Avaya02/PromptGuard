import type { JudgeInput, JudgeResult } from "@diditbreak/shared-types";

export interface LLMProvider {
  generate(prompt: string, input: string): Promise<string>;
  judge(context: JudgeInput): Promise<JudgeResult>;
}
