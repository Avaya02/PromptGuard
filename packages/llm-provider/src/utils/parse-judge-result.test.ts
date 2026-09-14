import { describe, expect, it } from "vitest";

import { parseJudgeResult } from "./parse-judge-result.js";

describe("parseJudgeResult", () => {
  it("parses a clean JSON object", () => {
    const result = parseJudgeResult('{"pass":true,"reason":"looks good","drift":0.2}');
    expect(result.pass).toBe(true);
    expect(result.reason).toBe("looks good");
    expect(result.drift).toBe(0.2);
  });

  it("extracts JSON embedded in surrounding prose", () => {
    const result = parseJudgeResult(
      'Sure! Here is my verdict:\n{"pass":false,"reason":"tone shifted","drift":0.8}\nHope that helps.'
    );
    expect(result.pass).toBe(false);
    expect(result.drift).toBe(0.8);
  });

  it("handles a fenced code block", () => {
    const result = parseJudgeResult('```json\n{"pass":true,"reason":"ok","drift":0}\n```');
    expect(result.pass).toBe(true);
  });

  it("treats any non-true pass value as a failure", () => {
    expect(parseJudgeResult('{"pass":"yes","reason":"r","drift":0}').pass).toBe(false);
    expect(parseJudgeResult('{"pass":1,"reason":"r","drift":0}').pass).toBe(false);
  });

  it("coerces a numeric string drift", () => {
    expect(parseJudgeResult('{"pass":true,"reason":"r","drift":"0.4"}').drift).toBe(0.4);
  });

  it("defaults drift to 1 when it is unparseable", () => {
    expect(parseJudgeResult('{"pass":true,"reason":"r","drift":"abc"}').drift).toBe(1);
    expect(parseJudgeResult('{"pass":true,"reason":"r"}').drift).toBe(1);
  });

  it("substitutes a message when reason is missing or not a string", () => {
    expect(parseJudgeResult('{"pass":true,"drift":0}').reason).toContain("did not provide");
    expect(parseJudgeResult('{"pass":true,"reason":42,"drift":0}').reason).toContain(
      "did not provide"
    );
  });

  describe("malformed input fails closed", () => {
    for (const [label, raw] of [
      ["empty string", ""],
      ["whitespace only", "   \n  "],
      ["prose with no JSON", "I think the response is fine."],
      ["unbalanced braces", '{"pass":true,'],
      ["invalid JSON syntax", "{pass: true, drift: 0}"],
      ["a closing brace with no object", "} no json here {"]
    ] as const) {
      it(`returns a failing result for ${label}`, () => {
        const result = parseJudgeResult(raw);
        // Failing closed matters: an unreadable judge must never silently pass.
        expect(result.pass).toBe(false);
        expect(result.drift).toBe(1);
        expect(result.raw).toBe(raw);
      });
    }
  });

  it("extracts greedily from the first brace to the last", () => {
    // Documents current behaviour: a stray leading brace is skipped, and the
    // widest brace span is what gets parsed.
    expect(parseJudgeResult('} {"pass":true,"reason":"r","drift":0}').pass).toBe(true);

    // The flip side is that two adjacent objects span into invalid JSON and
    // therefore fail closed rather than silently taking the first.
    expect(parseJudgeResult('{"pass":true} and {"pass":false}').pass).toBe(false);
  });

  it("preserves the raw payload for debugging", () => {
    const raw = '{"pass":true,"reason":"r","drift":0}';
    expect(parseJudgeResult(raw).raw).toBe(raw);
  });
});
