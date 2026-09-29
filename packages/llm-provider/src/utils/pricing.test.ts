import { describe, expect, it } from "vitest";

import { estimateCostUsd, lookupPrice } from "./pricing.js";

describe("lookupPrice", () => {
  it("finds an exact model id", () => {
    expect(lookupPrice("gpt-4o-mini")).toEqual({ inputPerMillion: 0.15, outputPerMillion: 0.6 });
  });

  it("resolves a dated id by prefix", () => {
    expect(lookupPrice("claude-3-5-haiku-20241022")).toEqual(
      lookupPrice("claude-3-5-haiku")
    );
  });

  it("prefers the longest matching prefix", () => {
    // "gpt-4o-mini" must win over the shorter "gpt-4o".
    expect(lookupPrice("gpt-4o-mini-2024-07-18")?.inputPerMillion).toBe(0.15);
  });

  it("returns undefined for an unknown model", () => {
    expect(lookupPrice("some-unreleased-model")).toBeUndefined();
  });
});

describe("estimateCostUsd", () => {
  it("computes input and output cost", () => {
    // 1M in at $2.50 + 1M out at $10.00
    expect(estimateCostUsd("gpt-4o", 1_000_000, 1_000_000)).toBeCloseTo(12.5, 6);
  });

  it("is zero for local and mock models", () => {
    expect(estimateCostUsd("llama3", 5000, 5000)).toBe(0);
    expect(estimateCostUsd("mock", 5000, 5000)).toBe(0);
  });

  it("keeps precision on sub-cent amounts", () => {
    const cost = estimateCostUsd("gemini-1.5-flash", 1000, 200);
    expect(cost).toBeGreaterThan(0);
    expect(cost).toBeLessThan(0.001);
  });

  it("returns undefined for an unpriced model", () => {
    expect(estimateCostUsd("unknown-model", 100, 100)).toBeUndefined();
  });

  it("is zero at zero tokens", () => {
    expect(estimateCostUsd("gpt-4o", 0, 0)).toBe(0);
  });
});
