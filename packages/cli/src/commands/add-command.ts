import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { definePrompt, readPromptRegistry } from "@diditbreak/sdk";
import chalk from "chalk";

import { CliError, isFileNotFound } from "../errors.js";

export interface AddCommandArgs {
  name: string;
  /** Path to a file holding the prompt text. */
  file?: string | undefined;
  /** Inline prompt text, for one-liners and scripts. */
  content?: string | undefined;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

async function resolveContent(cwd: string, args: AddCommandArgs): Promise<string> {
  if (args.content !== undefined) {
    return args.content;
  }

  if (args.file !== undefined) {
    try {
      return await readFile(resolve(cwd, args.file), "utf-8");
    } catch (error) {
      if (isFileNotFound(error)) {
        throw new CliError(
          `Prompt file not found: ${args.file}`,
          "Pass a path to a file containing the prompt text, or use --content \"...\"."
        );
      }
      throw error;
    }
  }

  // Piped input (`cat prompt.md | diditbreak add name`) is the third source.
  if (!process.stdin.isTTY) {
    return readStdin();
  }

  throw new CliError(
    "No prompt content given.",
    "Use `diditbreak add <name> <file>`, `--content \"...\"`, or pipe the text on stdin."
  );
}

/**
 * Registers or updates a prompt from the command line.
 *
 * The SDK's definePrompt() is the in-code path; this is the same operation for
 * teams whose prompts live in files rather than application code.
 */
export async function runAddCommand(args: AddCommandArgs): Promise<number> {
  const cwd = process.cwd();

  try {
    // Trailing whitespace from editors and heredocs is noise, not intent, and
    // would otherwise register as a content change on every re-add.
    const content = (await resolveContent(cwd, args)).replace(/\s+$/, "");

    if (content.length === 0) {
      throw new CliError(
        "Prompt content is empty.",
        "Check the file or --content value; an empty prompt cannot be tested."
      );
    }

    const before = (await readPromptRegistry({ cwd })).find((prompt) => prompt.name === args.name);
    const prompt = await definePrompt(args.name, content, { cwd });

    if (before && before.version === prompt.version) {
      console.log(`${chalk.dim("=")} ${prompt.name} unchanged ${chalk.dim(`(v${prompt.version})`)}`);
    } else if (before) {
      console.log(
        `${chalk.green("✓")} ${prompt.name} updated ${chalk.dim(`v${before.version} → v${prompt.version}`)}`
      );
    } else {
      console.log(`${chalk.green("✓")} ${prompt.name} registered ${chalk.dim(`(v${prompt.version})`)}`);
    }

    return 0;
  } catch (error) {
    if (error instanceof CliError) {
      console.error(`${chalk.red("✗")} ${error.message}\n  ${error.hint}`);
      return 1;
    }

    console.error(`${chalk.red("✗")} ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}
