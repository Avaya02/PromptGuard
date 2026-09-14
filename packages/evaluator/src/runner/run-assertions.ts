import type { Assertion } from "@promptguard/shared-types";
import { Ajv, type ValidateFunction } from "ajv";

export interface AssertionFailure {
  check: string;
  detail: string;
}

export interface AssertionOutcome {
  pass: boolean;
  failures: AssertionFailure[];
}

const ajv = new Ajv({ allErrors: true, strict: false });

// Compiling a JSON schema is the expensive part, and suites reuse the same
// schema across every case in a file, so cache by serialised schema.
const schemaCache = new Map<string, ValidateFunction>();

function compileSchema(schema: Record<string, unknown>): ValidateFunction {
  const key = JSON.stringify(schema);
  const cached = schemaCache.get(key);
  if (cached) {
    return cached;
  }

  const validate = ajv.compile(schema);
  schemaCache.set(key, validate);
  return validate;
}

function toList(value: string | string[]): string[] {
  return Array.isArray(value) ? value : [value];
}

/**
 * Evaluates deterministic checks against a model response.
 *
 * Pure and synchronous: no network, no tokens. `latencyMs` is the measured
 * generation latency, needed for the `max_latency_ms` check.
 */
export function runAssertions(
  assertion: Assertion,
  output: string,
  latencyMs: number
): AssertionOutcome {
  const failures: AssertionFailure[] = [];

  if (assertion.contains !== undefined) {
    for (const needle of toList(assertion.contains)) {
      if (!output.includes(needle)) {
        failures.push({ check: "contains", detail: `expected output to contain ${JSON.stringify(needle)}` });
      }
    }
  }

  if (assertion.not_contains !== undefined) {
    for (const needle of toList(assertion.not_contains)) {
      if (output.includes(needle)) {
        failures.push({
          check: "not_contains",
          detail: `expected output not to contain ${JSON.stringify(needle)}`
        });
      }
    }
  }

  if (assertion.regex !== undefined) {
    let pattern: RegExp | null = null;
    try {
      pattern = new RegExp(assertion.regex);
    } catch {
      failures.push({ check: "regex", detail: `invalid pattern ${JSON.stringify(assertion.regex)}` });
    }

    if (pattern && !pattern.test(output)) {
      failures.push({ check: "regex", detail: `output did not match /${assertion.regex}/` });
    }
  }

  if (assertion.json_schema !== undefined) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(output);
    } catch {
      failures.push({ check: "json_schema", detail: "output is not valid JSON" });
      parsed = undefined;
    }

    if (parsed !== undefined) {
      const validate = compileSchema(assertion.json_schema);
      if (!validate(parsed)) {
        const detail = (validate.errors ?? [])
          .map((error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`)
          .join("; ");
        failures.push({ check: "json_schema", detail: detail || "output failed schema validation" });
      }
    }
  }

  if (assertion.max_latency_ms !== undefined && latencyMs > assertion.max_latency_ms) {
    failures.push({
      check: "max_latency_ms",
      detail: `took ${latencyMs}ms, budget ${assertion.max_latency_ms}ms`
    });
  }

  return { pass: failures.length === 0, failures };
}

export function formatFailures(failures: AssertionFailure[]): string {
  return failures.map((failure) => `${failure.check}: ${failure.detail}`).join(" | ");
}
