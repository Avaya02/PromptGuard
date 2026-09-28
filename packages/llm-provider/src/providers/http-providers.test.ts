import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AnthropicProvider } from "./anthropic-provider.js";
import { GeminiProvider } from "./gemini-provider.js";
import { GroqProvider } from "./groq-provider.js";
import { OpenAIProvider } from "./openai-provider.js";

const originalFetch = globalThis.fetch;

type FetchArgs = Parameters<typeof fetch>;

/**
 * Installs a typed fetch double and returns its recorded calls.
 *
 * vi.fn() on a zero-arg arrow types mock.calls as an empty tuple, so the
 * signature is declared explicitly to keep call inspection type-safe.
 */
function stubFetch(handler: (...args: FetchArgs) => Promise<Response>): {
  calls: FetchArgs[];
} {
  const calls: FetchArgs[] = [];
  globalThis.fetch = (async (...args: FetchArgs) => {
    calls.push(args);
    return handler(...args);
  }) as typeof fetch;

  return { calls };
}

function requestBody(args: FetchArgs): Record<string, unknown> {
  return JSON.parse(String((args[1] as RequestInit).body));
}

function requestHeaders(args: FetchArgs): Record<string, string> {
  return (args[1] as RequestInit).headers as Record<string, string>;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

const JUDGE_BODY = '{"pass":true,"reason":"fine","drift":0.1}';

beforeEach(() => {
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  vi.stubEnv("GEMINI_API_KEY", "test-key");
  vi.stubEnv("GROQ_API_KEY", "test-key");
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("provider API key handling", () => {
  it("throws a named error when the key is absent", () => {
    vi.unstubAllEnvs();
    expect(() => new AnthropicProvider()).toThrow(/ANTHROPIC_API_KEY/);
    expect(() => new GeminiProvider()).toThrow(/GEMINI_API_KEY/);
    expect(() => new GroqProvider()).toThrow(/GROQ_API_KEY/);
    expect(() => new OpenAIProvider({ generationModel: "gpt-4o" })).toThrow(/OPENAI_API_KEY/);
  });

  it("accepts an explicit apiKey without any env var", () => {
    vi.unstubAllEnvs();
    expect(() => new AnthropicProvider({ apiKey: "inline" })).not.toThrow();
  });

  it("honours a custom apiKeyEnvVar", () => {
    vi.unstubAllEnvs();
    vi.stubEnv("MY_CUSTOM_KEY", "value");
    expect(() => new GroqProvider({ apiKeyEnvVar: "MY_CUSTOM_KEY" })).not.toThrow();
  });
});

describe("OpenAIProvider against OpenAI-compatible servers", () => {
  it("runs keyless when a custom baseUrl is set", async () => {
    vi.unstubAllEnvs();
    const { calls } = stubFetch(async () =>
      jsonResponse({ choices: [{ message: { content: "hi" } }], usage: {} })
    );

    const provider = new OpenAIProvider({ generationModel: "llama-3", baseUrl: "http://localhost:8000" });
    await expect(provider.generate("s", "u")).resolves.toBe("hi");

    // No key, so no Authorization header rather than "Bearer undefined".
    expect(requestHeaders(calls[0]!).authorization).toBeUndefined();
    expect(String(calls[0]![0])).toBe("http://localhost:8000/v1/chat/completions");
  });

  it("still sends a key to a custom server when one is configured", async () => {
    const { calls } = stubFetch(async () =>
      jsonResponse({ choices: [{ message: { content: "hi" } }], usage: {} })
    );

    await new OpenAIProvider({ generationModel: "m", baseUrl: "http://vllm:8000", apiKey: "secret" }).generate("s", "u");
    expect(requestHeaders(calls[0]!).authorization).toBe("Bearer secret");
  });
});

describe("AnthropicProvider", () => {
  it("extracts text blocks and reports token usage", async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({
        content: [
          { type: "text", text: "part one " },
          { type: "thinking", text: "ignored" },
          { type: "text", text: "part two" }
        ],
        usage: { input_tokens: 10, output_tokens: 5 }
      })
    ) as typeof fetch;

    const provider = new AnthropicProvider({ apiKey: "k" });
    expect(await provider.generate("system", "user")).toBe("part one part two");
  });

  it("sends the version header and system prompt", async () => {
    const { calls } = stubFetch(async () =>
      jsonResponse({ content: [{ type: "text", text: JUDGE_BODY }], usage: {} })
    );

    await new AnthropicProvider({ apiKey: "k" }).judge({
      input: "i",
      responseB: "b",
      expect: "r"
    });

    const headers = requestHeaders(calls[0]!);
    expect(headers["anthropic-version"]).toBeDefined();
    expect(headers["x-api-key"]).toBe("k");

    const body = requestBody(calls[0]!);
    expect(body.system).toContain("regression judge");
    expect(body.temperature).toBe(0);
  });

  it("attaches an estimated cost for a priced model", async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({
        content: [{ type: "text", text: JUDGE_BODY }],
        usage: { input_tokens: 1000, output_tokens: 500 }
      })
    ) as typeof fetch;

    const result = await new AnthropicProvider({
      apiKey: "k",
      generationModel: "claude-3-5-haiku-latest"
    }).judge({ input: "i", responseB: "b", expect: "r" });

    expect(result.tokensUsed).toBe(1500);
    expect(result.estimatedCostUsd).toBeGreaterThan(0);
  });
});

describe("GeminiProvider", () => {
  it("joins candidate parts and requests JSON mode when judging", async () => {
    const { calls } = stubFetch(async () =>
      jsonResponse({
        candidates: [{ content: { parts: [{ text: JUDGE_BODY }] } }],
        usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 4 }
      })
    );

    const result = await new GeminiProvider({ apiKey: "k" }).judge({
      input: "i",
      responseB: "b",
      expect: "r"
    });

    expect(result.drift).toBe(0.1);
    expect(result.tokensUsed).toBe(12);

    const config = requestBody(calls[0]!).generationConfig as Record<string, unknown>;
    expect(config.responseMimeType).toBe("application/json");
  });

  it("does not request JSON mode for plain generation", async () => {
    const { calls } = stubFetch(async () =>
      jsonResponse({ candidates: [{ content: { parts: [{ text: "hi" }] } }] })
    );

    await new GeminiProvider({ apiKey: "k" }).generate("system", "user");

    const config = requestBody(calls[0]!).generationConfig as Record<string, unknown>;
    expect(config.responseMimeType).toBeUndefined();
  });

  it("throws when the response carries no candidates", async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({ candidates: [] })) as typeof fetch;
    await expect(new GeminiProvider({ apiKey: "k" }).generate("s", "u")).rejects.toThrow(
      /no text content/
    );
  });
});

describe("GroqProvider", () => {
  it("uses the OpenAI-compatible chat shape", async () => {
    const { calls } = stubFetch(async () =>
      jsonResponse({
        choices: [{ message: { content: JUDGE_BODY } }],
        usage: { prompt_tokens: 20, completion_tokens: 10 }
      })
    );

    const result = await new GroqProvider({ apiKey: "k" }).judge({
      input: "i",
      responseB: "b",
      expect: "r"
    });

    expect(result.tokensUsed).toBe(30);
    expect(String(calls[0]![0])).toContain("/v1/chat/completions");

    const body = requestBody(calls[0]!);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages).toHaveLength(2);
  });
});

describe("retry behaviour over HTTP", () => {
  it("retries a 429 and then succeeds", async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        return new Response("rate limited", { status: 429 });
      }
      return jsonResponse({
        choices: [{ message: { content: "recovered" } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 }
      });
    }) as typeof fetch;

    const provider = new OpenAIProvider({ generationModel: "gpt-4o-mini", apiKey: "k" });
    await expect(provider.generate("s", "u")).resolves.toBe("recovered");
    expect(calls).toBe(2);
  });

  it("does not retry a 401", async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls += 1;
      return new Response("unauthorized", { status: 401 });
    }) as typeof fetch;

    const provider = new GroqProvider({ apiKey: "bad" });
    await expect(provider.generate("s", "u")).rejects.toThrow();
    expect(calls).toBe(1);
  });

  it("surfaces the final error after exhausting retries", async () => {
    globalThis.fetch = vi.fn(async () => new Response("down", { status: 503 })) as typeof fetch;

    const provider = new GeminiProvider({ apiKey: "k" });
    await expect(provider.generate("s", "u")).rejects.toThrow(/503/);
  });
});
