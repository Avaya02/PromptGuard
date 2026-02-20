import { LocalOllamaProvider, MockProvider, OpenAIProvider, type LLMProvider } from "@promptguard/llm-provider";
import type { ModelConfig } from "@promptguard/shared-types";

export function createProvider(modelConfig: ModelConfig): LLMProvider {
  switch (modelConfig.provider) {
    case "local": {
      const options: {
        generationModel: string;
        judgeModel: string;
        baseUrl?: string;
      } = {
        generationModel: modelConfig.model,
        judgeModel: modelConfig.model
      };

      if (modelConfig.baseUrl !== undefined) {
        options.baseUrl = modelConfig.baseUrl;
      }

      return new LocalOllamaProvider(options);
    }
    case "openai": {
      const options: {
        generationModel: string;
        judgeModel: string;
        baseUrl?: string;
        apiKeyEnvVar?: string;
      } = {
        generationModel: modelConfig.model,
        judgeModel: modelConfig.model
      };

      if (modelConfig.baseUrl !== undefined) {
        options.baseUrl = modelConfig.baseUrl;
      }

      if (modelConfig.apiKeyEnvVar !== undefined) {
        options.apiKeyEnvVar = modelConfig.apiKeyEnvVar;
      }

      return new OpenAIProvider(options);
    }
    case "mock":
      return new MockProvider();
    default:
      throw new Error(`Unsupported provider: ${modelConfig.provider}`);
  }
}
