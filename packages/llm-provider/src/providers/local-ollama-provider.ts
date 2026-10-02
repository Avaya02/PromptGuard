import type { JudgeInput, JudgeResult } from "@diditbreak/shared-types";

import type { LLMProvider } from "../llm-provider.js";
import { parseJudgeResult } from "../utils/parse-judge-result.js";
import { buildJudgePrompt } from "../utils/judge-prompt.js";

export interface LocalOllamaProviderOptions {
  generationModel: string;
  judgeModel?: string;
  baseUrl?: string;
  temperature?: number;
}

interface OllamaGenerateResponse {
  response?: string;
}

export class LocalOllamaProvider implements LLMProvider {
  private readonly baseUrl: string;
  private readonly generationModel: string;
  private readonly judgeModel: string;
  private readonly temperature: number;

  constructor(options: LocalOllamaProviderOptions) {
    this.baseUrl = options.baseUrl ?? "http://127.0.0.1:11434";
    this.generationModel = options.generationModel;
    this.judgeModel = options.judgeModel ?? options.generationModel;
    this.temperature = options.temperature ?? 0;
  }

  async generate(prompt: string, input: string): Promise<string> {
    return this.request(this.generationModel, `${prompt}\n\n${input}`);
  }

  async judge(context: JudgeInput): Promise<JudgeResult> {
    const raw = await this.request(this.judgeModel, buildJudgePrompt(context));
    return parseJudgeResult(raw);
  }

  private async request(model: string, prompt: string): Promise<string> {
    const response = await fetch(`${this.baseUrl}/api/generate`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        options: {
          temperature: this.temperature
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Ollama request failed with status ${response.status}`);
    }

    const payload = (await response.json()) as OllamaGenerateResponse;
    if (!payload.response) {
      throw new Error("Ollama response missing `response` field");
    }

    return payload.response;
  }
}
