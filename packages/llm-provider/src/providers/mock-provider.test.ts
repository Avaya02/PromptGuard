import { describe, expect, it } from "vitest";

import { MockProvider } from "./mock-provider.js";

describe("MockProvider", () => {
  describe("determinism", () => {
    it("returns the same output for the same input across instances", async () => {
      const a = new MockProvider();
      const b = new MockProvider();

      const first = await a.generate("prompt", "hello world");
      const second = await b.generate("different prompt", "hello world");

      // Output keys off the input only, so suites reproduce across processes.
      expect(first).toBe(second);
    });

    it("returns different output for different inputs", async () => {
      const provider = new MockProvider();
      const a = await provider.generate("p", "input one");
      const b = await provider.generate("p", "input two");

      expect(a).not.toBe(b);
    });

    it("passes the judge by default with zero cost", async () => {
      const provider = new MockProvider();
      const result = await provider.judge({ input: "i", responseB: "b", expect: "r" });

      expect(result.pass).toBe(true);
      expect(result.drift).toBe(0);
      expect(result.tokensUsed).toBe(0);
      expect(result.estimatedCostUsd).toBe(0);
    });
  });

  describe("fixtures", () => {
    it("returns a fixture response on a substring match", async () => {
      const provider = new MockProvider({
        fixtures: [{ match: "refund", response: "Your refund is on its way." }]
      });

      expect(await provider.generate("p", "I want a refund please")).toBe(
        "Your refund is on its way."
      );
    });

    it("supports regex matching", async () => {
      const provider = new MockProvider({
        fixtures: [{ match: /order #\d+/, response: "Order located." }]
      });

      expect(await provider.generate("p", "check order #4821")).toBe("Order located.");
    });

    it("uses the first matching fixture", async () => {
      const provider = new MockProvider({
        fixtures: [
          { match: "hello", response: "first" },
          { match: "hello", response: "second" }
        ]
      });

      expect(await provider.generate("p", "hello")).toBe("first");
    });

    it("falls back to the hash response when nothing matches", async () => {
      const provider = new MockProvider({
        fixtures: [{ match: "nope", response: "unused" }]
      });

      expect(await provider.generate("p", "something else")).toMatch(/^mock-response-[0-9a-f]{12}$/);
    });

    it("prefers an explicit generatedOutput over the hash fallback", async () => {
      const provider = new MockProvider({ generatedOutput: "canned" });
      expect(await provider.generate("p", "abc")).toBe("canned:abc");
    });
  });

  describe("failure injection", () => {
    it("never throws at failureRate 0", async () => {
      const provider = new MockProvider({ failureRate: 0 });
      for (let i = 0; i < 20; i += 1) {
        await expect(provider.generate("p", `input-${i}`)).resolves.toBeTypeOf("string");
      }
    });

    it("always throws at failureRate 1", async () => {
      const provider = new MockProvider({ failureRate: 1 });
      await expect(provider.generate("p", "input")).rejects.toThrow("injected failure");
    });

    it("is reproducible for a given seed", async () => {
      const collect = async (): Promise<boolean[]> => {
        const provider = new MockProvider({ failureRate: 0.5, seed: 42 });
        const outcomes: boolean[] = [];
        for (let i = 0; i < 12; i += 1) {
          try {
            await provider.generate("p", `input-${i}`);
            outcomes.push(true);
          } catch {
            outcomes.push(false);
          }
        }
        return outcomes;
      };

      expect(await collect()).toEqual(await collect());
    });
  });

  describe("latency simulation", () => {
    it("adds no delay by default", async () => {
      const provider = new MockProvider();
      const started = Date.now();
      await provider.generate("p", "input");
      expect(Date.now() - started).toBeLessThan(50);
    });

    it("waits at least minLatencyMs", async () => {
      const provider = new MockProvider({ minLatencyMs: 30, maxLatencyMs: 40 });
      const started = Date.now();
      await provider.generate("p", "input");
      expect(Date.now() - started).toBeGreaterThanOrEqual(25);
    });
  });
});
