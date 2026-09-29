import { describe, expect, it } from "vitest";

import { hashPrompt } from "./hash.js";

describe("hashPrompt", () => {
  it("is deterministic for identical content", () => {
    expect(hashPrompt("you are helpful")).toBe(hashPrompt("you are helpful"));
  });

  it("produces a 64-character hex sha256", () => {
    expect(hashPrompt("anything")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differs for content differing by one character", () => {
    expect(hashPrompt("prompt a")).not.toBe(hashPrompt("prompt b"));
  });

  it("is whitespace sensitive", () => {
    // Trailing whitespace changes model behaviour, so it must change the hash.
    expect(hashPrompt("text")).not.toBe(hashPrompt("text "));
    expect(hashPrompt("a b")).not.toBe(hashPrompt("a  b"));
  });

  it("handles empty and unicode content", () => {
    expect(hashPrompt("")).toMatch(/^[0-9a-f]{64}$/);
    expect(hashPrompt("emoji 🎯 and accents é")).not.toBe(hashPrompt("emoji and accents e"));
  });
});
