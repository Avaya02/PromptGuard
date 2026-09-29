import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { runAddCommand } from "./commands/add-command.js";
import { runDoctorCommand } from "./commands/doctor-command.js";
import { runInitCommand } from "./commands/init-command.js";
import { runTestCommand } from "./commands/test-command.js";
import { CLI_VERSION } from "./version.js";

export async function runCli(argv: string[]): Promise<void> {
  const cli = yargs(hideBin(argv));

  await cli
    .scriptName("promptguard")
    .usage("$0 <command> [options]\n\nRegression tests for LLM prompts. Deterministic checks run free; an LLM judge runs only when needed.")
    .command(
      "init",
      "Scaffold config, a sample prompt, and a passing sample suite",
      (command) =>
        command
          .option("provider", {
            type: "string",
            default: "mock",
            choices: ["mock", "ollama", "openai", "anthropic", "gemini", "groq"],
            describe: "Provider to write into promptguard.config.ts"
          })
          .option("force", {
            type: "boolean",
            default: false,
            describe: "Overwrite existing files"
          }),
      async (args) => {
        process.exitCode = await runInitCommand({ provider: args.provider, force: args.force });
      }
    )
    .command(
      "test",
      "Run the regression suite against every registered prompt",
      (command) =>
        command
          .option("base", {
            type: "string",
            describe: "Git ref to compare against, e.g. origin/main"
          })
          .option("json", {
            type: "boolean",
            default: false,
            describe: "Print a machine-readable report on stdout"
          })
          .epilogue("Exit codes: 0 pass · 1 a prompt regressed · 2 setup or configuration error"),
      async (args) => {
        process.exitCode = await runTestCommand({ base: args.base, json: args.json });
      }
    )
    .command(
      "add <name> [file]",
      "Register a prompt, or update it when its content changed",
      (command) =>
        command
          .positional("name", { type: "string", demandOption: true, describe: "Prompt name" })
          .positional("file", { type: "string", describe: "File containing the prompt text" })
          .option("content", { type: "string", describe: "Prompt text inline, instead of a file" }),
      async (args) => {
        process.exitCode = await runAddCommand({
          name: args.name,
          file: args.file,
          content: args.content
        });
      }
    )
    .command(
      "doctor",
      "Check config, provider keys, prompts, and git setup",
      () => {},
      async () => {
        process.exitCode = await runDoctorCommand();
      }
    )
    .example("$0 init", "Start a new project (runs offline, no API key)")
    .example("$0 add support-agent prompts/support.md", "Register a prompt from a file")
    .example("$0 test --base origin/main", "Compare against the main branch")
    .example("$0 test --json > report.json", "Machine-readable output for CI")
    .demandCommand(1, "")
    .recommendCommands()
    .strict()
    .version(CLI_VERSION)
    .alias("v", "version")
    .help()
    .alias("h", "help")
    .wrap(Math.min(100, cli.terminalWidth()))
    .parseAsync();
}
