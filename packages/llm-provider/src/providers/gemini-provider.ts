import type { JudgeInput, JudgeResult } from "@promptguard/shared-types";

import type { LLMProvider } from "../llm-provider.js";
import { buildJudgePrompt } from "../utils/judge-prompt.js";
import { parseJudgeResult } from "../utils/parse-judge-result.js";
import { estimateCostUsd } from "../utils/pricing.js";
import { HttpError, withRetry } from "../utils/retry.js";

export interface GeminiProviderOptions {
  generationModel?: string;
  judgeModel?: string;
  apiKey?: string;
  apiKeyEnvVar?: string;
  baseUrl?: string;
}

const DEFAULT_MODEL = "gemini-1.5-flash";

interface GeminiGenerateResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
}

export class GeminiProvider implements LLMProvider {
  private readonly baseUrl: string;
  private readonly generationModel: string;
  private readonly judgeModel: string;
  private readonly apiKey: string;

  constructor(options: GeminiProviderOptions = {}) {
    this.baseUrl = options.baseUrl ?? "https://generativelanguage.googleapis.com";
    this.generationModel = options.generationModel ?? DEFAULT_MODEL;
    this.judgeModel = options.judgeModel ?? this.generationModel;

    const apiKeyEnvVar = options.apiKeyEnvVar ?? "GEMINI_API_KEY";
    const resolved = options.apiKey ?? process.env[apiKeyEnvVar];
    if (!resolved) {
      throw new Error(`Missing Gemini API key. Set ${apiKeyEnvVar} or pass apiKey in options.`);
    }

    this.apiKey = resolved;
  }

  async generate(prompt: string, input: string): Promise<string> {
    const result = await this.request(this.generationModel, prompt, input, false);
    return result.content;
  }

  async judge(context: JudgeInput): Promise<JudgeResult> {
    // Gemini supports a native JSON response mode, which removes most of the
    // "model wrapped JSON in prose" failure mode. parseJudgeResult still runs
    // as a fallback extractor.
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
      const url = `${this.baseUrl}/v1beta/models/${model}:generateContent`;

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": this.apiKey
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: userContent }] }],
          generationConfig: {
            temperature: 0,
            ...(jsonMode ? { responseMimeType: "application/json" } : {})
          }
        })
      });

      if (!response.ok) {
        throw new HttpError(response.status, await response.text().catch(() => ""));
      }

      const payload = (await response.json()) as GeminiGenerateResponse;
      const content = (payload.candidates?.[0]?.content?.parts ?? [])
        .map((part) => part.text ?? "")
        .join("");

      if (!content) {
        throw new Error("Gemini response contained no text content");
      }

      return {
        content,
        inputTokens: payload.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: payload.usageMetadata?.candidatesTokenCount ?? 0
      };
    });
  }
}
