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
  expect: z.string().nullable()
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
