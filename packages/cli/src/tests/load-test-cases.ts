import { readFile, readdir } from "node:fs/promises";
import { relative, resolve } from "node:path";

import type { EvaluationTestCase } from "@promptguard/evaluator";
import { assertionSchema } from "@promptguard/shared-types";
import { z } from "zod";

import { PromptGuardCliError, isFileNotFound } from "../errors.js";

const testCaseSchema = z
  .object({
    input: z.string().min(1),
    expect: z.string().min(1).nullable().optional(),
    assert: assertionSchema.optional()
  })
  .refine((testCase) => testCase.expect != null || testCase.assert !== undefined, {
    message: "Each test case needs `expect` (LLM judge rubric) or `assert` (deterministic checks)."
  });

const testFileSchema = z.object({
  cases: z.array(testCaseSchema).min(1)
});

export async function loadTestCases(cwd: string, testsDir: string): Promise<EvaluationTestCase[]> {
  const dirPath = resolve(cwd, testsDir);

  let entries;
  try {
    entries = await readdir(dirPath, { withFileTypes: true });
  } catch (error) {
    if (isFileNotFound(error)) {
      throw new PromptGuardCliError(
        `Test directory not found: ${relative(cwd, dirPath) || dirPath}`,
        "Run `prompt-guard init` to scaffold it, or point `testsDir` in promptguard.config.ts at an existing directory."
      );
    }

    throw error;
  }

  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  if (files.length === 0) {
    throw new PromptGuardCliError(
      `No .json test files in ${relative(cwd, dirPath) || dirPath}`,
      "Add a test file, or run `prompt-guard init` to generate a sample."
    );
  }

  const allCases: EvaluationTestCase[] = [];

  for (const fileName of files) {
    const filePath = resolve(dirPath, fileName);
    const raw = await readFile(filePath, "utf-8");

    let parsed;
    try {
      parsed = testFileSchema.parse(JSON.parse(raw));
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new PromptGuardCliError(
        `Invalid test file: ${fileName}`,
        `Expected {"cases":[{"input":"...","expect":"..."}]}. Parser said: ${detail}`
      );
    }

    parsed.cases.forEach((testCase, index) => {
      allCases.push({
        name: `${fileName}#${index + 1}`,
        input: testCase.input,
        expect: testCase.expect ?? null,
        ...(testCase.assert !== undefined ? { assert: testCase.assert } : {})
      });
    });
  }

  return allCases;
}
