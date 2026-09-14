import { describe, expect, it } from "vitest";

import { PromptGuardCliError, isFileNotFound } from "./errors.js";

describe("PromptGuardCliError", () => {
  it("carries a message and a remediation hint", () => {
    const error = new PromptGuardCliError("something broke", "try this instead");

    expect(error.message).toBe("something broke");
    expect(error.hint).toBe("try this instead");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("PromptGuardCliError");
  });
});

describe("isFileNotFound", () => {
  it("detects an ENOENT error", () => {
    const error = Object.assign(new Error("missing"), { code: "ENOENT" });
    expect(isFileNotFound(error)).toBe(true);
  });

  it("rejects other error codes", () => {
    expect(isFileNotFound(Object.assign(new Error("denied"), { code: "EACCES" }))).toBe(false);
    expect(isFileNotFound(new Error("plain"))).toBe(false);
    expect(isFileNotFound("not an error")).toBe(false);
    expect(isFileNotFound(null)).toBe(false);
  });
});
