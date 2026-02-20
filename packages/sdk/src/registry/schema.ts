import { z } from "zod";

export const registeredPromptSchema = z.object({
  name: z.string().min(1),
  content: z.string(),
  hash: z.string().min(1),
  version: z.number().int().positive(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const promptRegistrySchema = z.object({
  prompts: z.array(registeredPromptSchema)
});

export type PromptRegistry = z.infer<typeof promptRegistrySchema>;
