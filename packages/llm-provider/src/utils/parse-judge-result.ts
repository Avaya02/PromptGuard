import type { JudgeResult } from "@diditbreak/shared-types";

function extractJson(raw: string): string {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");

  if (start === -1 || end === -1 || end < start) {
    throw new Error("No JSON object found in judge response");
  }

  return raw.slice(start, end + 1);
}

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return 1;
}

export function parseJudgeResult(raw: string): JudgeResult {
  try {
    const parsed = JSON.parse(extractJson(raw)) as {
      pass?: unknown;
      reason?: unknown;
      drift?: unknown;
    };

    return {
      pass: parsed.pass === true,
      reason: typeof parsed.reason === "string" ? parsed.reason : "Judge did not provide a reason.",
      drift: toNumber(parsed.drift),
      raw
    };
  } catch {
    return {
      pass: false,
      reason: "Unable to parse judge response into expected JSON structure.",
      drift: 1,
      raw
    };
  }
}
