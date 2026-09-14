import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";

import chalk from "chalk";

export interface InitCommandArgs {
  /** Provider written into the generated config. Defaults to the zero-cost mock. */
  provider?: string | undefined;
  /** Overwrite files that already exist. */
  force?: boolean | undefined;
}

const PROVIDER_PRESETS: Record<string, { generation: string; judge: string; note: string }> = {
  mock: {
    generation: `{ provider: "mock", model: "mock" }`,
    judge: `{ provider: "mock", model: "mock" }`,
    note: "No API key required. Deterministic output, ideal for CI and first runs."
  },
  ollama: {
    generation: `{ provider: "local", model: "llama3" }`,
    judge: `{ provider: "local", model: "llama3" }`,
    note: "Requires a local Ollama daemon on http://127.0.0.1:11434."
  },
  openai: {
    generation: `{ provider: "openai", model: "gpt-4o-mini" }`,
    judge: `{ provider: "openai", model: "gpt-4o-mini" }`,
    note: "Requires OPENAI_API_KEY."
  },
  anthropic: {
    generation: `{ provider: "anthropic", model: "claude-3-5-haiku-latest" }`,
    judge: `{ provider: "anthropic", model: "claude-3-5-haiku-latest" }`,
    note: "Requires ANTHROPIC_API_KEY."
  },
  gemini: {
    generation: `{ provider: "gemini", model: "gemini-1.5-flash" }`,
    judge: `{ provider: "gemini", model: "gemini-1.5-flash" }`,
    note: "Requires GEMINI_API_KEY. Free tier available."
  },
  groq: {
    generation: `{ provider: "groq", model: "llama3-8b-8192" }`,
    judge: `{ provider: "groq", model: "llama3-8b-8192" }`,
    note: "Requires GROQ_API_KEY. Free tier available."
  }
};

function buildConfig(provider: string): string {
  const preset = PROVIDER_PRESETS[provider] ?? PROVIDER_PRESETS.mock!;

  return `// PromptGuard configuration.
// ${preset.note}
export default {
  // Max share of failing cases tolerated before a prompt is judged regressed.
  threshold: 0.1,
  testsDir: "prompt_tests",
  // Cases run in parallel, bounded so providers are not rate limited.
  concurrency: 5,
  generationModel: ${preset.generation},
  judgeModel: ${preset.judge}
};
`;
}

const SAMPLE_TESTS = `{
  "cases": [
    {
      "input": "Return a JSON object with keys \\"status\\" and \\"code\\".",
      "assert": {
        "json_schema": {
          "type": "object",
          "required": ["status", "code"],
          "properties": {
            "status": { "type": "string" },
            "code": { "type": "number" }
          }
        },
        "not_contains": "I'm sorry",
        "max_latency_ms": 10000
      }
    },
    {
      "input": "A customer is angry their order arrived damaged. Reply to them.",
      "expect": "Apologises, acknowledges the damage, and offers a refund or replacement without blaming the customer."
    }
  ]
}
`;

const SAMPLE_PROMPT_USAGE = `// Register prompts from your application code:
//
//   import { definePrompt } from "@promptguard/sdk";
//
//   await definePrompt(
//     "customer-support-agent",
//     "You are a helpful support agent. Be concise and empathetic."
//   );
//
// definePrompt writes to .promptguard/prompts.json, which MUST be committed:
// \`prompt-guard test --base <ref>\` reads the baseline from git history.
`;

async function writeIfAbsent(
  path: string,
  contents: string,
  force: boolean
): Promise<"created" | "skipped"> {
  if (!force) {
    try {
      await readFile(path, "utf-8");
      return "skipped";
    } catch {
      // Not present, fall through and create it.
    }
  }

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents, "utf-8");
  return "created";
}

export async function runInitCommand(args: InitCommandArgs): Promise<number> {
  const cwd = process.cwd();
  const provider = args.provider ?? "mock";
  const force = args.force ?? false;

  if (!(provider in PROVIDER_PRESETS)) {
    console.error(
      chalk.red(`Unknown provider "${provider}".`),
      `Choose one of: ${Object.keys(PROVIDER_PRESETS).join(", ")}`
    );
    return 1;
  }

  const actions: Array<[string, "created" | "skipped"]> = [];

  const configPath = resolve(cwd, "promptguard.config.ts");
  actions.push(["promptguard.config.ts", await writeIfAbsent(configPath, buildConfig(provider), force)]);

  const samplePath = resolve(cwd, "prompt_tests", "sample.json");
  actions.push([
    relative(cwd, samplePath),
    await writeIfAbsent(samplePath, SAMPLE_TESTS, force)
  ]);

  // Seed an empty registry so `prompt-guard test` fails with a clear message
  // about definePrompt rather than a missing directory.
  const registryPath = resolve(cwd, ".promptguard", "prompts.json");
  actions.push([
    relative(cwd, registryPath),
    await writeIfAbsent(registryPath, `{\n  "prompts": []\n}\n`, force)
  ]);

  const readmePath = resolve(cwd, ".promptguard", "README.md");
  actions.push([relative(cwd, readmePath), await writeIfAbsent(readmePath, SAMPLE_PROMPT_USAGE, force)]);

  console.log("");
  for (const [file, state] of actions) {
    const label = state === "created" ? chalk.green("created") : chalk.yellow("exists ");
    console.log(`  ${label}  ${file}`);
  }

  console.log("");
  console.log(chalk.bold("PromptGuard initialised."), `Provider: ${chalk.cyan(provider)}`);
  console.log(`  ${PROVIDER_PRESETS[provider]!.note}`);
  console.log("");
  console.log("Next:");
  console.log("  1. Register a prompt with definePrompt() — see .promptguard/README.md");
  console.log("  2. Commit .promptguard/prompts.json (baselines are read from git history)");
  console.log("  3. Run `prompt-guard test`");
  console.log("");

  return 0;
}
