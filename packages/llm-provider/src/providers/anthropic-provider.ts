import type { JudgeInput, JudgeResult } from "@diditbreak/shared-types";

import type { LLMProvider } from "../llm-provider.js";
import { buildJudgePrompt } from "../utils/judge-prompt.js";
import { parseJudgeResult } from "../utils/parse-judge-result.js";
import { estimateCostUsd } from "../utils/pricing.js";
import { HttpError, withRetry } from "../utils/retry.js";

export interface AnthropicProviderOptions {
  generationModel?: string;
  judgeModel?: string;
  apiKey?: string;
  apiKeyEnvVar?: string;
  baseUrl?: string;
  maxTokens?: number;
}

const DEFAULT_MODEL = "claude-3-5-haiku-latest";
const ANTHROPIC_VERSION = "2023-06-01";

interface AnthropicMessagesResponse {
  content?: Array<{ type?: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

export class AnthropicProvider implements LLMProvider {
  private readonly baseUrl: string;
  private readonly generationModel: string;
  private readonly judgeModel: string;
  private readonly apiKey: string;
  private readonly maxTokens: number;

  constructor(options: AnthropicProviderOptions = {}) {
    this.baseUrl = options.baseUrl ?? "https://api.anthropic.com";
    this.generationModel = options.generationModel ?? DEFAULT_MODEL;
    this.judgeModel = options.judgeModel ?? this.generationModel;
    this.maxTokens = options.maxTokens ?? 1024;

    const apiKeyEnvVar = options.apiKeyEnvVar ?? "ANTHROPIC_API_KEY";
    const resolved = options.apiKey ?? process.env[apiKeyEnvVar];
    if (!resolved) {
      throw new Error(`Missing Anthropic API key. Set ${apiKeyEnvVar} or pass apiKey in options.`);
    }

    this.apiKey = resolved;
  }

  async generate(prompt: string, input: string): Promise<string> {
    const result = await this.request(this.generationModel, prompt, input);
    return result.content;
  }

  async judge(context: JudgeInput): Promise<JudgeResult> {
    const result = await this.request(
      this.judgeModel,
      "You are a strict regression judge. Return only JSON.",
      buildJudgePrompt(context)
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
    userContent: string
  ): Promise<{ content: string; inputTokens: number; outputTokens: number }> {
    return withRetry(async () => {
      const response = await fetch(`${this.baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": ANTHROPIC_VERSION
        },
        body: JSON.stringify({
          model,
          max_tokens: this.maxTokens,
          temperature: 0,
          system,
          messages: [{ role: "user", content: userContent }]
        })
      });

      if (!response.ok) {
        throw new HttpError(response.status, await response.text().catch(() => ""));
      }

      const payload = (await response.json()) as AnthropicMessagesResponse;
      const content = (payload.content ?? [])
        .filter((block) => block.type === "text" && typeof block.text === "string")
        .map((block) => block.text)
        .join("");

      if (!content) {
        throw new Error("Anthropic response contained no text content");
      }

      return {
        content,
        inputTokens: payload.usage?.input_tokens ?? 0,
        outputTokens: payload.usage?.output_tokens ?? 0
      };
    });
  }
}
