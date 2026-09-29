import { describe, expect, it } from "vitest";

import { buildJudgePrompt } from "./judge-prompt.js";

describe("buildJudgePrompt", () => {
  it("builds a rubric prompt when expect is set", () => {
    const prompt = buildJudgePrompt({
      input: "the input",
      responseB: "the response",
      expect: "must be polite"
    });

    expect(prompt).toContain("the input");
    expect(prompt).toContain("the response");
    expect(prompt).toContain("must be polite");
    expect(prompt).toContain("Rubric:");
    expect(prompt).not.toContain("Response A:");
  });

  it("builds an A/B comparison prompt when expect is null", () => {
    const prompt = buildJudgePrompt({
      input: "the input",
      responseA: "old output",
      responseB: "new output",
      expect: null
    });

    expect(prompt).toContain("Response A: old output");
    expect(prompt).toContain("Response B: new output");
    expect(prompt).toContain("detect regressions");
  });

  it("tolerates a missing baseline response", () => {
    const prompt = buildJudgePrompt({ input: "i", responseB: "b", expect: null });
    expect(prompt).toContain("Response A: ");
  });

  it("always requests the JSON contract", () => {
    for (const expected of ["rubric text", null]) {
      const prompt = buildJudgePrompt({ input: "i", responseB: "b", expect: expected });
      expect(prompt).toContain('"pass"');
      expect(prompt).toContain('"drift"');
    }
  });
});
