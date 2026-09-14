import { assertionSchema } from "@promptguard/shared-types";
import { z } from "zod";

const modelConfigSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  baseUrl: z.string().url().optional(),
  apiKeyEnvVar: z.string().min(1).optional()
});

const testCaseSchema = z.object({
  name: z.string().min(1),
  input: z.string().min(1),
  expect: z.string().nullable().optional(),
  assert: assertionSchema.optional()
});

const runPromptInputSchema = z.object({
  name: z.string().min(1),
  versionA: z.string().optional(),
  versionB: z.string().min(1)
});

export const createRunRequestSchema = z.object({
  commitSha: z.string().min(1),
  environment: z.enum(["LOCAL", "CI", "PROD"]),
  threshold: z.number().min(0).max(1),
  generationModel: modelConfigSchema,
  judgeModel: modelConfigSchema,
  prompts: z.array(runPromptInputSchema).min(1),
  testCases: z.array(testCaseSchema).min(1)
});

export const runIdParamsSchema = z.object({
  id: z.string().min(1)
});

export const promptIdParamsSchema = z.object({
  id: z.string().min(1)
});

export const listRunsQuerySchema = z.object({
  status: z.enum(["PENDING", "RUNNING", "COMPLETED", "FAILED"]).optional(),
  environment: z.enum(["LOCAL", "CI", "PROD"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().min(1).optional()
});

export const evaluateRequestSchema = z.object({
  prompt: z.string().min(1),
  input: z.string().min(1),
  expect: z.string().min(1).nullable().optional(),
  assert: assertionSchema.optional(),
  generationModel: modelConfigSchema.optional(),
  judgeModel: modelConfigSchema.optional()
});
