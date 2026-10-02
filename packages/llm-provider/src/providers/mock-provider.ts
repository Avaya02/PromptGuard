import { createHash } from "node:crypto";

import type { JudgeInput, JudgeResult } from "@diditbreak/shared-types";

import type { LLMProvider } from "../llm-provider.js";

export interface MockFixture {
  /** Substring or /regex/ matched against the case input. */
  match: string | RegExp;
  response: string;
}

export interface MockProviderOptions {
  /** Fixed output, used when no fixture matches and no hash fallback is wanted. */
  generatedOutput?: string;
  judgeResult?: Partial<JudgeResult>;
  /** Input pattern to canned response. First match wins. */
  fixtures?: MockFixture[];
  minLatencyMs?: number;
  maxLatencyMs?: number;
  /** 0..1 chance a call throws, for exercising error paths. */
  failureRate?: number;
  /** Seed makes failure injection reproducible. */
  seed?: number;
}

const DEFAULT_JUDGE_RESULT: JudgeResult = {
  pass: true,
  reason: "Mock judge accepted response.",
  drift: 0,
  tokensUsed: 0,
  estimatedCostUsd: 0
};

/** Small deterministic PRNG (mulberry32) so seeded runs reproduce exactly. */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Offline provider used for tests, CI, and the zero-config demo.
 *
 * Output is deterministic for a given input, so regression suites produce
 * stable results without any network access or API key.
 */
export class MockProvider implements LLMProvider {
  private readonly generatedOutput: string | undefined;
  private readonly judgeResult: JudgeResult;
  private readonly fixtures: MockFixture[];
  private readonly minLatencyMs: number;
  private readonly maxLatencyMs: number;
  private readonly failureRate: number;
  private readonly random: () => number;

  constructor(options: MockProviderOptions = {}) {
    this.generatedOutput = options.generatedOutput;
    this.judgeResult = { ...DEFAULT_JUDGE_RESULT, ...options.judgeResult };
    this.fixtures = options.fixtures ?? [];
    this.minLatencyMs = options.minLatencyMs ?? 0;
    this.maxLatencyMs = Math.max(options.maxLatencyMs ?? 0, options.minLatencyMs ?? 0);
    this.failureRate = options.failureRate ?? 0;
    this.random = createRandom(options.seed ?? 1);
  }

  async generate(_prompt: string, input: string): Promise<string> {
    await this.simulate("generate");

    for (const fixture of this.fixtures) {
      const matched =
        typeof fixture.match === "string"
          ? input.includes(fixture.match)
          : fixture.match.test(input);

      if (matched) {
        return fixture.response;
      }
    }

    if (this.generatedOutput !== undefined) {
      return `${this.generatedOutput}:${input}`;
    }

    // No fixture: derive a stable pseudo-response from the input so repeated
    // runs agree with each other.
    const digest = createHash("sha256").update(input).digest("hex").slice(0, 12);
    return `mock-response-${digest}`;
  }

  async judge(_context: JudgeInput): Promise<JudgeResult> {
    await this.simulate("judge");
    return this.judgeResult;
  }

  private async simulate(operation: string): Promise<void> {
    if (this.maxLatencyMs > 0) {
      const span = this.maxLatencyMs - this.minLatencyMs;
      await sleep(this.minLatencyMs + Math.floor(this.random() * (span + 1)));
    }

    if (this.failureRate > 0 && this.random() < this.failureRate) {
      throw new Error(`MockProvider injected failure during ${operation}.`);
    }
  }
}
