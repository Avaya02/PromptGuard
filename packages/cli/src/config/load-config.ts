import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Buffer } from "node:buffer";

import type { DiditbreakConfig } from "@diditbreak/shared-types";
import { transform } from "sucrase";
import { z } from "zod";

import { CliError, isFileNotFound } from "../errors.js";

const modelConfigSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  baseUrl: z.string().url().optional(),
  apiKeyEnvVar: z.string().min(1).optional()
});

const configSchema = z.object({
  threshold: z.number().min(0).max(1),
  testsDir: z.string().min(1),
  generationModel: modelConfigSchema,
  judgeModel: modelConfigSchema,
  concurrency: z.number().int().positive().optional()
});

export async function loadConfig(cwd: string): Promise<DiditbreakConfig> {
  const configPath = resolve(cwd, "diditbreak.config.ts");

  let source: string;
  try {
    source = await readFile(configPath, "utf-8");
  } catch (error) {
    if (isFileNotFound(error)) {
      throw new CliError(
        "No diditbreak.config.ts found in this directory.",
        "Run `diditbreak init` to create one."
      );
    }

    throw error;
  }

  // Sucrase only strips types, which is all a config file needs. It replaced
  // the full TypeScript compiler here: 1.6 MB instead of 23 MB on every cold
  // `npx diditbreak` install.
  const transpiled = transform(source, { transforms: ["typescript"], filePath: configPath });

  const dataUrl = `data:text/javascript;base64,${Buffer.from(transpiled.code).toString("base64")}`;
  const loaded = await import(dataUrl);
  return configSchema.parse(loaded.default);
}
