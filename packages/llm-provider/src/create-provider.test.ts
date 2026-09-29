import { afterEach, describe, expect, it, vi } from "vitest";

import { createProvider } from "./create-provider.js";
import { AnthropicProvider } from "./providers/anthropic-provider.js";
import { GeminiProvider } from "./providers/gemini-provider.js";
import { GroqProvider } from "./providers/groq-provider.js";
import { LocalOllamaProvider } from "./providers/local-ollama-provider.js";
import { MockProvider } from "./providers/mock-provider.js";
import { OpenAIProvider } from "./providers/openai-provider.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("createProvider", () => {
  it("defaults to MockProvider when no config is supplied", () => {
    // This is what makes a zero-config `prompt-guard test` work with no keys.
    expect(createProvider()).toBeInstanceOf(MockProvider);
  });

  it("builds each supported provider", () => {
    vi.stubEnv("OPENAI_API_KEY", "k");
    vi.stubEnv("ANTHROPIC_API_KEY", "k");
    vi.stubEnv("GEMINI_API_KEY", "k");
    vi.stubEnv("GROQ_API_KEY", "k");

    expect(createProvider({ provider: "mock", model: "mock" })).toBeInstanceOf(MockProvider);
    expect(createProvider({ provider: "local", model: "llama3" })).toBeInstanceOf(
      LocalOllamaProvider
    );
    expect(createProvider({ provider: "openai", model: "gpt-4o-mini" })).toBeInstanceOf(
      OpenAIProvider
    );
    expect(createProvider({ provider: "anthropic", model: "claude-3-5-haiku-latest" })).toBeInstanceOf(
      AnthropicProvider
    );
    expect(createProvider({ provider: "gemini", model: "gemini-1.5-flash" })).toBeInstanceOf(
      GeminiProvider
    );
    expect(createProvider({ provider: "groq", model: "llama3-8b-8192" })).toBeInstanceOf(
      GroqProvider
    );
  });

  it("names the supported providers when given an unknown one", () => {
    expect(() => createProvider({ provider: "cohere", model: "x" })).toThrow(/Unsupported provider/);
    expect(() => createProvider({ provider: "cohere", model: "x" })).toThrow(/anthropic/);
  });

  it("passes baseUrl through for self-hosted endpoints", () => {
    const provider = createProvider({
      provider: "local",
      model: "llama3",
      baseUrl: "http://gpu-box:11434"
    });

    expect(provider).toBeInstanceOf(LocalOllamaProvider);
  });

  it("propagates a missing-key error from the underlying provider", () => {
    expect(() => createProvider({ provider: "openai", model: "gpt-4o" })).toThrow(/OPENAI_API_KEY/);
  });
});
