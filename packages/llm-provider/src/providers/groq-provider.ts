import type { JudgeInput, JudgeResult } from "@promptguard/shared-types";

import type { LLMProvider } from "../llm-provider.js";
import { buildJudgePrompt } from "../utils/judge-prompt.js";
import { parseJudgeResult } from "../utils/parse-judge-result.js";
import { estimateCostUsd } from "../utils/pricing.js";
import { HttpError, withRetry } from "../utils/retry.js";

export interface GroqProviderOptions {
  generationModel?: string;
  judgeModel?: string;
  apiKey?: string;
  apiKeyEnvVar?: string;
  baseUrl?: string;
}

const DEFAULT_MODEL = "llama3-8b-8192";

interface GroqChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/** Groq exposes an OpenAI-compatible chat completions API. */
export class GroqProvider implements LLMProvider {
  private readonly baseUrl: string;
  private readonly generationModel: string;
  private readonly judgeModel: string;
  private readonly apiKey: string;

  constructor(options: GroqProviderOptions = {}) {
    this.baseUrl = options.baseUrl ?? "https://api.groq.com/openai";
    this.generationModel = options.generationModel ?? DEFAULT_MODEL;
    this.judgeModel = options.judgeModel ?? this.generationModel;

    const apiKeyEnvVar = options.apiKeyEnvVar ?? "GROQ_API_KEY";
    const resolved = options.apiKey ?? process.env[apiKeyEnvVar];
    if (!resolved) {
      throw new Error(`Missing Groq API key. Set ${apiKeyEnvVar} or pass apiKey in options.`);
    }

    this.apiKey = resolved;
  }

  async generate(prompt: string, input: string): Promise<string> {
    const result = await this.request(this.generationModel, prompt, input, false);
    return result.content;
  }

  async judge(context: JudgeInput): Promise<JudgeResult> {
    const result = await this.request(
      this.judgeModel,
      "You are a strict regression judge. Return only JSON.",
      buildJudgePrompt(context),
      true
    );

    const parsed = parseJudgeResult(result.content);
    const cost = estimateCostUsd(this.judgeModel, result.inputTokens, result.outputTokens);

    return {
      ...parsed,
      tokensUsed: result.inputTokens + result.outputTokens,
      ...(cost !== undefined ? { estimatedCostUsd: cost } : {})
    };
  }

  private async request(
    model: string,
    system: string,
    userContent: string,
    jsonMode: boolean
  ): Promise<{ content: string; inputTokens: number; outputTokens: number }> {
    return withRetry(async () => {
      const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
          messages: [
            { role: "system", content: system },
            { role: "user", content: userContent }
          ]
        })
      });

      if (!response.ok) {
        throw new HttpError(response.status, await response.text().catch(() => ""));
      }

      const payload = (await response.json()) as GroqChatResponse;
      const content = payload.choices?.[0]?.message?.content;

      if (!content) {
        throw new Error("Groq response missing assistant content");
      }

      return {
        content,
        inputTokens: payload.usage?.prompt_tokens ?? 0,
        outputTokens: payload.usage?.completion_tokens ?? 0
      };
    });
  }
}
