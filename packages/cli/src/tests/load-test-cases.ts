import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import type { EvaluationTestCase } from "@promptguard/evaluator";
import { z } from "zod";

const testCaseSchema = z.object({
  input: z.string().min(1),
  expect: z.string().min(1).nullable()
});

const testFileSchema = z.object({
  cases: z.array(testCaseSchema).min(1)
});

export async function loadTestCases(cwd: string, testsDir: string): Promise<EvaluationTestCase[]> {
  const dirPath = resolve(cwd, testsDir);
  const entries = await readdir(dirPath, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  const allCases: EvaluationTestCase[] = [];

  for (const fileName of files) {
    const filePath = resolve(dirPath, fileName);
    const parsed = testFileSchema.parse(JSON.parse(await readFile(filePath, "utf-8")));

    parsed.cases.forEach((testCase, index) => {
      allCases.push({
        name: `${fileName}#${index + 1}`,
        input: testCase.input,
        expect: testCase.expect
      });
    });
  }

  if (allCases.length === 0) {
    throw new Error(`No test cases found in ${dirPath}.`);
  }

  return allCases;
}
