import type { JudgeInput, JudgeResult } from "@diditbreak/shared-types";

import type { LLMProvider } from "../llm-provider.js";
import { buildJudgePrompt } from "../utils/judge-prompt.js";
import { parseJudgeResult } from "../utils/parse-judge-result.js";
import { estimateCostUsd } from "../utils/pricing.js";
import { HttpError, withRetry } from "../utils/retry.js";

export interface OpenAIProviderOptions {
  generationModel: string;
  judgeModel?: string;
  apiKey?: string;
  apiKeyEnvVar?: string;
  baseUrl?: string;
}

interface OpenAIChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  usage?: {
    total_tokens?: number;
    prompt_tokens?: number;
    completion_tokens?: number;
  };
}

export class OpenAIProvider implements LLMProvider {
  private readonly baseUrl: string;
  private readonly generationModel: string;
  private readonly judgeModel: string;
  private readonly apiKey: string | undefined;

  constructor(options: OpenAIProviderOptions) {
    this.baseUrl = options.baseUrl ?? "https://api.openai.com";
    this.generationModel = options.generationModel;
    this.judgeModel = options.judgeModel ?? options.generationModel;

    const apiKeyEnvVar = options.apiKeyEnvVar ?? "OPENAI_API_KEY";
    const resolvedApiKey = options.apiKey ?? process.env[apiKeyEnvVar];

    // A custom baseUrl means an OpenAI-compatible server (vLLM, llama.cpp,
    // LM Studio), which is commonly run without auth. Only api.openai.com
    // itself always requires a key.
    if (!resolvedApiKey && options.baseUrl === undefined) {
      throw new Error(`Missing OpenAI API key. Set ${apiKeyEnvVar} or pass apiKey in options.`);
    }

    this.apiKey = resolvedApiKey;
  }

  async generate(prompt: string, input: string): Promise<string> {
    const payload = await this.request(
      this.generationModel,
      [
        { role: "system", content: prompt },
        { role: "user", content: input }
      ],
      false
    );

    return payload.content;
  }

  async judge(context: JudgeInput): Promise<JudgeResult> {
    const payload = await this.request(
      this.judgeModel,
      [
        { role: "system", content: "You are a strict regression judge. Return only JSON." },
        { role: "user", content: buildJudgePrompt(context) }
      ],
      true
    );

    const parsed = parseJudgeResult(payload.content);
    const cost = estimateCostUsd(this.judgeModel, payload.inputTokens, payload.outputTokens);

    return {
      ...parsed,
      tokensUsed: payload.totalTokens,
      ...(cost !== undefined ? { estimatedCostUsd: cost } : {})
    };
  }

  private async request(
    model: string,
    messages: Array<{ role: "system" | "user"; content: string }>,
    jsonMode: boolean
  ): Promise<{
    content: string;
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
  }> {
    return withRetry(async () => {
      const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.apiKey !== undefined ? { authorization: `Bearer ${this.apiKey}` } : {})
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
          messages
        })
      });

      if (!response.ok) {
        throw new HttpError(response.status, await response.text().catch(() => ""));
      }

      const payload = (await response.json()) as OpenAIChatCompletionResponse;
      const content = payload.choices?.[0]?.message?.content;

      if (!content) {
        throw new Error("OpenAI response missing assistant content");
      }

      const inputTokens = payload.usage?.prompt_tokens ?? 0;
      const outputTokens = payload.usage?.completion_tokens ?? 0;

      return {
        content,
        totalTokens: payload.usage?.total_tokens ?? inputTokens + outputTokens,
        inputTokens,
        outputTokens
      };
    });
  }
}
