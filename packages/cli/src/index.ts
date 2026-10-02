import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { runAddCommand } from "./commands/add-command.js";
import { runDoctorCommand } from "./commands/doctor-command.js";
import { runAblateCommand, runCompareCommand, runReportCommand } from "./commands/experiment-command.js";
import { runInitCommand } from "./commands/init-command.js";
import { runTestCommand } from "./commands/test-command.js";
import { CLI_VERSION } from "./version.js";

const experimentOptions = {
  trials: { type: "number", describe: "Runs per task per setup (default 3)" },
  tasks: { type: "string", describe: "Task directory (default .diditbreak/tasks)" },
  agent: { type: "string", choices: ["claude-code", "mock"], describe: "Agent to run (mock is free and offline)" },
  model: { type: "string", describe: "Model for the agent, e.g. sonnet or haiku" },
  concurrency: { type: "number", describe: "Agent runs in parallel (default 2)" },
  yes: { type: "boolean", alias: "y", default: false, describe: "Skip the cost confirmation" },
  json: { type: "boolean", default: false, describe: "Print a machine-readable summary" }
} as const;

function pickExperimentOptions(args: Record<string, unknown>) {
  return {
    trials: typeof args.trials === "number" ? args.trials : undefined,
    tasks: typeof args.tasks === "string" ? args.tasks : undefined,
    agent: typeof args.agent === "string" ? args.agent : undefined,
    model: typeof args.model === "string" ? args.model : undefined,
    concurrency: typeof args.concurrency === "number" ? args.concurrency : undefined,
    yes: args.yes === true,
    json: args.json === true
  };
}

export async function runCli(argv: string[]): Promise<void> {
  const cli = yargs(hideBin(argv));

  await cli
    .scriptName("diditbreak")
    .usage(
      "$0 <command> [options]\n\nDid your CLAUDE.md, AGENTS.md or skills change make your coding agent better or worse?\nRuns real tasks in sandboxes under each setup and measures success, cost and behaviour."
    )
    .command(
      "init",
      "Set up agent experiments here (or --demo for a ready-made example)",
      (command) =>
        command
          .option("demo", {
            type: "string",
            describe: "Create a ready-made demo repository in this directory (default diditbreak-demo)",
            coerce: (value: unknown) => (value === "" || value === true ? "diditbreak-demo" : value)
          })
          .option("prompts", {
            type: "boolean",
            default: false,
            describe: "Scaffold the prompt regression suite instead"
          })
          .option("provider", {
            type: "string",
            default: "mock",
            choices: ["mock", "ollama", "openai", "anthropic", "gemini", "groq"],
            describe: "Provider for the prompt suite (with --prompts)"
          })
          .option("force", {
            type: "boolean",
            default: false,
            describe: "Overwrite existing files"
          }),
      async (args) => {
        process.exitCode = await runInitCommand({
          provider: args.provider,
          force: args.force,
          prompts: args.prompts,
          ...(typeof args.demo === "string" ? { demo: args.demo } : {})
        });
      }
    )
    .command(
      "compare [setups..]",
      "Compare agent context setups on your tasks (default: HEAD vs working)",
      (command) =>
        command
          .positional("setups", {
            type: "string",
            array: true,
            describe: "Git refs, `working` (uncommitted edits) or `none` (no context)"
          })
          .option("baseline", {
            type: "boolean",
            default: true,
            describe: "Include the no-context baseline (--no-baseline to skip)"
          })
          .option("reference", { type: "string", describe: "Setup to compare against (default: first non-baseline)" })
          .options(experimentOptions)
          .epilogue("Exit codes: 0 no regression · 1 the last setup is clearly worse · 2 setup or configuration error"),
      async (args) => {
        process.exitCode = await runCompareCommand({
          setups: (args.setups as string[] | undefined) ?? [],
          baseline: args.baseline,
          reference: args.reference,
          ...pickExperimentOptions(args)
        });
      }
    )
    .command(
      "ablate [file]",
      "Remove one section or skill at a time to find what helps and what hurts",
      (command) =>
        command
          .positional("file", { type: "string", default: "CLAUDE.md", describe: "Context file to split into sections" })
          .option("from", { type: "string", default: "working", describe: "Setup to ablate: `working` or a git ref" })
          .option("skills", { type: "boolean", default: true, describe: "Also remove each skill (--no-skills to skip)" })
          .options(experimentOptions),
      async (args) => {
        process.exitCode = await runAblateCommand({
          file: args.file,
          from: args.from,
          skills: args.skills,
          ...pickExperimentOptions(args)
        });
      }
    )
    .command(
      "report [path]",
      "Show the results of a past experiment (default: the latest)",
      (command) =>
        command
          .positional("path", { type: "string", describe: "A results.json from .diditbreak/runs" })
          .option("reference", { type: "string", describe: "Setup to compare against" })
          .option("json", { type: "boolean", default: false, describe: "Print a machine-readable summary" }),
      async (args) => {
        process.exitCode = await runReportCommand({ path: args.path, reference: args.reference, json: args.json });
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
    .example("$0 compare", "Is my uncommitted CLAUDE.md edit better than HEAD?")
    .example("$0 compare main my-branch", "Compare the agent setup on two branches")
    .example("$0 ablate CLAUDE.md", "Find which section of CLAUDE.md helps or hurts")
    .example("$0 compare --agent mock", "Try it free and offline with the scripted agent")
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
