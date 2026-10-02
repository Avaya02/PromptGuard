import type { ModelConfig } from "@diditbreak/shared-types";

import type { LLMProvider } from "./llm-provider.js";
import { AnthropicProvider } from "./providers/anthropic-provider.js";
import { GeminiProvider } from "./providers/gemini-provider.js";
import { GroqProvider } from "./providers/groq-provider.js";
import { LocalOllamaProvider } from "./providers/local-ollama-provider.js";
import { MockProvider } from "./providers/mock-provider.js";
import { OpenAIProvider } from "./providers/openai-provider.js";

export const SUPPORTED_PROVIDERS = [
  "mock",
  "local",
  "openai",
  "anthropic",
  "gemini",
  "groq"
] as const;

export type SupportedProvider = (typeof SUPPORTED_PROVIDERS)[number];

/**
 * Builds a provider from declarative config.
 *
 * Shared by the CLI and the worker so both understand exactly the same set of
 * providers. An absent config resolves to MockProvider, which is what makes a
 * zero-config `diditbreak test` work with no API key.
 */
export function createProvider(modelConfig?: ModelConfig): LLMProvider {
  if (!modelConfig) {
    return new MockProvider();
  }

  const shared = {
    generationModel: modelConfig.model,
    judgeModel: modelConfig.model,
    ...(modelConfig.baseUrl !== undefined ? { baseUrl: modelConfig.baseUrl } : {}),
    ...(modelConfig.apiKeyEnvVar !== undefined ? { apiKeyEnvVar: modelConfig.apiKeyEnvVar } : {})
  };

  switch (modelConfig.provider) {
    case "mock":
      return new MockProvider();
    case "local":
      // Ollama is unauthenticated, so apiKeyEnvVar has no meaning here.
      return new LocalOllamaProvider({
        generationModel: shared.generationModel,
        judgeModel: shared.judgeModel,
        ...(modelConfig.baseUrl !== undefined ? { baseUrl: modelConfig.baseUrl } : {})
      });
    case "openai":
      return new OpenAIProvider(shared);
    case "anthropic":
      return new AnthropicProvider(shared);
    case "gemini":
      return new GeminiProvider(shared);
    case "groq":
      return new GroqProvider(shared);
    default:
      throw new Error(
        `Unsupported provider: ${modelConfig.provider}. Supported: ${SUPPORTED_PROVIDERS.join(", ")}`
      );
  }
}
