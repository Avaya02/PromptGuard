import { describe, expect, it } from "vitest";

import { formatFailures, runAssertions } from "./run-assertions.js";

describe("runAssertions", () => {
  describe("contains", () => {
    it("passes when the substring is present", () => {
      expect(runAssertions({ contains: "hello" }, "well hello there", 0).pass).toBe(true);
    });

    it("fails when the substring is absent", () => {
      const outcome = runAssertions({ contains: "hello" }, "goodbye", 0);
      expect(outcome.pass).toBe(false);
      expect(outcome.failures[0]?.check).toBe("contains");
    });

    it("requires every entry of an array to be present", () => {
      expect(runAssertions({ contains: ["a", "b"] }, "a and b", 0).pass).toBe(true);

      const outcome = runAssertions({ contains: ["a", "z"] }, "a only", 0);
      expect(outcome.pass).toBe(false);
      expect(outcome.failures).toHaveLength(1);
    });
  });

  describe("not_contains", () => {
    it("fails when a forbidden substring appears", () => {
      const outcome = runAssertions({ not_contains: "sorry" }, "I am sorry", 0);
      expect(outcome.pass).toBe(false);
      expect(outcome.failures[0]?.check).toBe("not_contains");
    });

    it("passes when absent", () => {
      expect(runAssertions({ not_contains: "sorry" }, "sure thing", 0).pass).toBe(true);
    });
  });

  describe("regex", () => {
    it("passes on a match", () => {
      expect(runAssertions({ regex: "^\\d{3}-\\d{4}$" }, "555-1234", 0).pass).toBe(true);
    });

    it("fails on no match", () => {
      expect(runAssertions({ regex: "^\\d+$" }, "abc", 0).pass).toBe(false);
    });

    it("reports an invalid pattern instead of throwing", () => {
      const outcome = runAssertions({ regex: "([unclosed" }, "anything", 0);
      expect(outcome.pass).toBe(false);
      expect(outcome.failures[0]?.detail).toContain("invalid pattern");
    });
  });

  describe("json_schema", () => {
    const schema = {
      type: "object",
      required: ["status"],
      properties: { status: { type: "string" } }
    };

    it("passes for conforming JSON", () => {
      expect(runAssertions({ json_schema: schema }, '{"status":"ok"}', 0).pass).toBe(true);
    });

    it("fails when output is not JSON at all", () => {
      const outcome = runAssertions({ json_schema: schema }, "not json", 0);
      expect(outcome.pass).toBe(false);
      expect(outcome.failures[0]?.detail).toContain("not valid JSON");
    });

    it("fails when JSON violates the schema", () => {
      const outcome = runAssertions({ json_schema: schema }, '{"status":42}', 0);
      expect(outcome.pass).toBe(false);
      expect(outcome.failures[0]?.check).toBe("json_schema");
    });
  });

  describe("max_latency_ms", () => {
    it("passes at exactly the budget", () => {
      expect(runAssertions({ max_latency_ms: 100 }, "x", 100).pass).toBe(true);
    });

    it("fails one millisecond over", () => {
      const outcome = runAssertions({ max_latency_ms: 100 }, "x", 101);
      expect(outcome.pass).toBe(false);
      expect(outcome.failures[0]?.check).toBe("max_latency_ms");
    });
  });

  it("passes vacuously when no checks are configured", () => {
    expect(runAssertions({}, "anything", 999).pass).toBe(true);
  });

  it("accumulates every failure rather than stopping at the first", () => {
    const outcome = runAssertions(
      { contains: "yes", not_contains: "no", max_latency_ms: 10 },
      "no",
      50
    );

    expect(outcome.pass).toBe(false);
    expect(outcome.failures).toHaveLength(3);
    expect(formatFailures(outcome.failures)).toContain("contains");
    expect(formatFailures(outcome.failures)).toContain("max_latency_ms");
  });
});
