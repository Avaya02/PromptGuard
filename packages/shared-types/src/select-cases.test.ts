import { describe, expect, it } from "vitest";

import { selectCasesForPrompt, type NamedTestCase } from "./index.js";

const cases: NamedTestCase[] = [
  { name: "everyone", input: "i", expect: "r" },
  { name: "sql-only", input: "i", expect: "r", prompts: ["sql"] },
  { name: "both", input: "i", expect: "r", prompts: ["sql", "support"] }
];

describe("selectCasesForPrompt", () => {
  it("includes unscoped cases for every prompt", () => {
    expect(selectCasesForPrompt(cases, "anything").map((c) => c.name)).toEqual(["everyone"]);
  });

  it("includes scoped cases only for their prompts", () => {
    expect(selectCasesForPrompt(cases, "sql").map((c) => c.name)).toEqual(["everyone", "sql-only", "both"]);
    expect(selectCasesForPrompt(cases, "support").map((c) => c.name)).toEqual(["everyone", "both"]);
  });

  it("treats an empty scope list as matching nothing", () => {
    expect(selectCasesForPrompt([{ name: "x", input: "i", expect: "r", prompts: [] }], "sql")).toEqual([]);
  });
});
