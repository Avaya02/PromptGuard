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

const CONFIG_FILE = "diditbreak.config.ts";

/**
 * Loads diditbreak.config.ts and returns its default export, unvalidated.
 *
 * The file holds several independent sections (prompt testing, agent
 * experiments), each validated by the command that uses it, so an agent-only
 * project is not forced to fill in prompt-testing fields.
 *
 * Returns null when the file is absent and `required` is false.
 */
export async function loadConfigModule(cwd: string, options: { required: boolean }): Promise<unknown> {
  const configPath = resolve(cwd, CONFIG_FILE);

  let source: string;
  try {
    source = await readFile(configPath, "utf-8");
  } catch (error) {
    if (isFileNotFound(error)) {
      if (!options.required) {
        return null;
      }
      throw new CliError(`No ${CONFIG_FILE} found in this directory.`, "Run `diditbreak init` to create one.");
    }

    throw error;
  }

  // Sucrase only strips types, which is all a config file needs. It replaced
  // the full TypeScript compiler here: 1.6 MB instead of 23 MB on every cold
  // `npx diditbreak` install.
  const transpiled = transform(source, { transforms: ["typescript"], filePath: configPath });

  const dataUrl = `data:text/javascript;base64,${Buffer.from(transpiled.code).toString("base64")}`;
  const loaded = (await import(dataUrl)) as { default?: unknown };
  return loaded.default ?? null;
}

export async function loadConfig(cwd: string): Promise<DiditbreakConfig> {
  return configSchema.parse(await loadConfigModule(cwd, { required: true }));
}
