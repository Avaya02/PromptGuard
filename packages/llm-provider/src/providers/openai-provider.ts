import type { JudgeInput, JudgeResult } from "@promptguard/shared-types";

import type { LLMProvider } from "../llm-provider.js";
import { parseJudgeResult } from "../utils/parse-judge-result.js";
import { buildJudgePrompt } from "../utils/judge-prompt.js";

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
  };
}

export class OpenAIProvider implements LLMProvider {
  private readonly baseUrl: string;
  private readonly generationModel: string;
  private readonly judgeModel: string;
  private readonly apiKey: string;

  constructor(options: OpenAIProviderOptions) {
    this.baseUrl = options.baseUrl ?? "https://api.openai.com";
    this.generationModel = options.generationModel;
    this.judgeModel = options.judgeModel ?? options.generationModel;

    const apiKeyEnvVar = options.apiKeyEnvVar ?? "OPENAI_API_KEY";
    const resolvedApiKey = options.apiKey ?? process.env[apiKeyEnvVar];
    if (!resolvedApiKey) {
      throw new Error(`Missing OpenAI API key. Set ${apiKeyEnvVar} or pass apiKey in options.`);
    }

    this.apiKey = resolvedApiKey;
  }

  async generate(prompt: string, input: string): Promise<string> {
    const payload = await this.request(this.generationModel, [
      {
        role: "system",
        content: prompt
      },
      {
        role: "user",
        content: input
      }
    ]);

    return payload.content;
  }

  async judge(context: JudgeInput): Promise<JudgeResult> {
    const payload = await this.request(this.judgeModel, [
      {
        role: "system",
        content: "You are a strict regression judge. Return only JSON."
      },
      {
        role: "user",
        content: buildJudgePrompt(context)
      }
    ]);

    const parsed = parseJudgeResult(payload.content);
    if (payload.tokensUsed === undefined) {
      return parsed;
    }

    return {
      ...parsed,
      tokensUsed: payload.tokensUsed
    };
  }

  private async request(
    model: string,
    messages: Array<{ role: "system" | "user"; content: string }>
  ): Promise<{ content: string; tokensUsed?: number }> {
    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        messages
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI request failed with status ${response.status}`);
    }

    const payload = (await response.json()) as OpenAIChatCompletionResponse;
    const content = payload.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error("OpenAI response missing assistant content");
    }

    const tokensUsed = payload.usage?.total_tokens;
    if (tokensUsed === undefined) {
      return { content };
    }

    return { content, tokensUsed };
  }
}
