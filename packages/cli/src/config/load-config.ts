import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Buffer } from "node:buffer";

import type { PromptGuardConfig } from "@promptguard/shared-types";
import ts from "typescript";
import { z } from "zod";

const modelConfigSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  baseUrl: z.string().url().optional(),
  apiKeyEnvVar: z.string().min(1).optional()
});

const promptGuardConfigSchema = z.object({
  threshold: z.number().min(0).max(1),
  testsDir: z.string().min(1),
  generationModel: modelConfigSchema,
  judgeModel: modelConfigSchema
});

export async function loadConfig(cwd: string): Promise<PromptGuardConfig> {
  const configPath = resolve(cwd, "promptguard.config.ts");
  const source = await readFile(configPath, "utf-8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022
    }
  });

  const dataUrl = `data:text/javascript;base64,${Buffer.from(transpiled.outputText).toString("base64")}`;
  const loaded = await import(dataUrl);
  return promptGuardConfigSchema.parse(loaded.default);
}
