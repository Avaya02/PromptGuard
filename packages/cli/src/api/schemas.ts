import { z } from "zod";

export const runStatusSchema = z.enum(["PENDING", "RUNNING", "COMPLETED", "FAILED"]);
export const runEnvironmentSchema = z.enum(["LOCAL", "CI", "PROD"]);

export const runSummarySchema = z.object({
  id: z.string().min(1),
  commitSha: z.string().min(1),
  environment: runEnvironmentSchema,
  score: z.number().nullable(),
  status: runStatusSchema,
  expectedJobs: z.number().int().nonnegative(),
  completedJobs: z.number().int().nonnegative(),
  failedJobs: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const createRunResponseSchema = z.object({
  run: runSummarySchema
});

export const runResultRecordSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  promptName: z.string().min(1),
  testName: z.string().min(1),
  pass: z.boolean(),
  driftScore: z.number(),
  reasoning: z.string(),
  latencyMs: z.number().int().nonnegative(),
  tokensUsed: z.number().int().nonnegative(),
  assertionType: z.enum(["deterministic", "semantic"]).default("semantic"),
  estimatedCostUsd: z.number().nullable().default(null),
  createdAt: z.string()
});

export const runResultsSchema = z.array(runResultRecordSchema);
