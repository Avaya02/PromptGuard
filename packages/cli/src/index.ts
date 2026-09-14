import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { runInitCommand, type InitCommandArgs } from "./commands/init-command.js";
import { runTestCommand, type TestCommandArgs } from "./commands/test-command.js";

export async function runCli(argv: string[]): Promise<void> {
  await yargs(hideBin(argv))
    .scriptName("prompt-guard")
    .command(
      "init",
      "Scaffold PromptGuard config, sample tests, and an empty prompt registry",
      {
        provider: {
          type: "string",
          default: "mock",
          choices: ["mock", "ollama", "openai", "anthropic", "gemini", "groq"],
          describe: "Provider to write into promptguard.config.ts"
        },
        force: {
          type: "boolean",
          default: false,
          describe: "Overwrite existing files"
        }
      },
      async (args) => {
        const commandArgs: InitCommandArgs = {
          provider: typeof args.provider === "string" ? args.provider : undefined,
          force: args.force === true
        };

        process.exitCode = await runInitCommand(commandArgs);
      }
    )
    .command(
      "test",
      "Run semantic prompt regression tests",
      {
        base: {
          type: "string",
          describe: "Baseline branch or commit for comparison"
        }
      },
      async (args) => {
        const commandArgs: TestCommandArgs = {
          base: typeof args.base === "string" ? args.base : undefined
        };
        const code = await runTestCommand({
          ...commandArgs
        });

        process.exitCode = code;
      }
    )
    .demandCommand(1)
    .strict()
    .help()
    .parseAsync();
}
