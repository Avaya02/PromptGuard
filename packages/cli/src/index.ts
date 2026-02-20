import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { runTestCommand, type TestCommandArgs } from "./commands/test-command.js";

export async function runCli(argv: string[]): Promise<void> {
  await yargs(hideBin(argv))
    .scriptName("prompt-guard")
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
