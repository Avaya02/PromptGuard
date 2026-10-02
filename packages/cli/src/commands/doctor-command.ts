import { readdir } from "node:fs/promises";
import { resolve } from "node:path";

import type { ModelConfig, DiditbreakConfig, RegisteredPrompt } from "@diditbreak/shared-types";
import chalk from "chalk";
import { execa } from "execa";

import { loadConfig } from "../config/load-config.js";
import { CliError } from "../errors.js";
import { loadCurrentPrompts } from "../prompts/load-current-prompts.js";
import { loadTestCases } from "../tests/load-test-cases.js";
import { findUnknownScopes } from "./test-command.js";

export type CheckStatus = "ok" | "warn" | "fail" | "skip";

export interface CheckResult {
  status: CheckStatus;
  label: string;
  detail: string;
  /** The one command or edit that resolves a warn/fail. */
  fix?: string | undefined;
}

export interface DoctorEnvironment {
  cwd: string;
  env: NodeJS.ProcessEnv;
  nodeVersion: string;
  fetch: typeof fetch;
}

const MIN_NODE_MAJOR = 20;

const KEY_ENV_VARS: Record<string, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  gemini: "GEMINI_API_KEY",
  groq: "GROQ_API_KEY"
};

function describeError(error: unknown): { detail: string; fix?: string } {
  if (error instanceof CliError) {
    return { detail: error.message, fix: error.hint };
  }
  return { detail: error instanceof Error ? error.message : String(error) };
}

export function checkNode(nodeVersion: string): CheckResult {
  const major = Number(nodeVersion.replace(/^v/, "").split(".")[0]);
  return major >= MIN_NODE_MAJOR
    ? { status: "ok", label: "Node.js", detail: nodeVersion }
    : {
        status: "fail",
        label: "Node.js",
        detail: `${nodeVersion} is below the supported minimum`,
        fix: `Install Node ${MIN_NODE_MAJOR} or newer.`
      };
}

async function checkProvider(
  role: string,
  model: ModelConfig,
  environment: DoctorEnvironment
): Promise<CheckResult> {
  const label = `${role} model`;
  const id = `${model.provider}:${model.model}`;

  if (model.provider === "mock") {
    return { status: "ok", label, detail: `${id} (offline, no key needed)` };
  }

  if (model.provider === "local") {
    const baseUrl = model.baseUrl ?? "http://127.0.0.1:11434";
    try {
      const response = await environment.fetch(`${baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(1500)
      });
      return response.ok
        ? { status: "ok", label, detail: `${id} · Ollama reachable at ${baseUrl}` }
        : {
            status: "fail",
            label,
            detail: `Ollama at ${baseUrl} answered ${response.status}`,
            fix: "Check the Ollama daemon logs."
          };
    } catch {
      return {
        status: "fail",
        label,
        detail: `cannot reach Ollama at ${baseUrl}`,
        fix: `Start it with \`ollama serve\`, then \`ollama pull ${model.model}\`.`
      };
    }
  }

  if (model.provider === "openai" && model.baseUrl !== undefined) {
    const envVar = model.apiKeyEnvVar ?? KEY_ENV_VARS.openai!;
    return {
      status: "ok",
      label,
      detail: `${id} · OpenAI-compatible server at ${model.baseUrl}${environment.env[envVar] ? ` · ${envVar} is set` : " (no key)"}`
    };
  }

  const envVar = model.apiKeyEnvVar ?? KEY_ENV_VARS[model.provider];
  if (!envVar) {
    return {
      status: "fail",
      label,
      detail: `unknown provider "${model.provider}"`,
      fix: "Use one of: mock, local, openai, anthropic, gemini, groq."
    };
  }

  return environment.env[envVar]
    ? { status: "ok", label, detail: `${id} · ${envVar} is set` }
    : {
        status: "fail",
        label,
        detail: `${id} needs ${envVar}, which is not set`,
        fix: `export ${envVar}=...  (or switch this model to provider "mock" for offline runs)`
      };
}

async function checkRegistryInGit(cwd: string): Promise<CheckResult> {
  const label = "Baseline";
  const path = ".diditbreak/prompts.json";

  const inRepo = await execa("git", ["rev-parse", "--is-inside-work-tree"], { cwd, reject: false });
  if (inRepo.exitCode !== 0) {
    return {
      status: "warn",
      label,
      detail: "not a git repository — `--base` comparisons are unavailable",
      fix: "git init"
    };
  }

  const ignored = await execa("git", ["check-ignore", "-q", path], { cwd, reject: false });
  if (ignored.exitCode === 0) {
    // The failure mode this check exists for: an ignored registry makes every
    // baseline lookup come back empty, and the comparison silently checks nothing.
    return {
      status: "fail",
      label,
      detail: `${path} is gitignored, so --base has nothing to compare against`,
      fix: "Remove .diditbreak from .gitignore, then commit the registry."
    };
  }

  const tracked = await execa("git", ["ls-files", "--error-unmatch", path], { cwd, reject: false });
  return tracked.exitCode === 0
    ? { status: "ok", label, detail: `${path} is committed` }
    : {
        status: "warn",
        label,
        detail: `${path} is not committed yet`,
        fix: `git add ${path} && git commit -m "Register prompts"`
      };
}

async function checkRemoteApi(environment: DoctorEnvironment): Promise<CheckResult> {
  const label = "Remote API";
  const apiUrl = environment.env.DIDITBREAK_API_URL;

  if (!apiUrl) {
    return { status: "skip", label, detail: "DIDITBREAK_API_URL not set — runs execute locally" };
  }

  try {
    const response = await environment.fetch(`${apiUrl.replace(/\/$/, "")}/health`, {
      signal: AbortSignal.timeout(3000)
    });
    const body = (await response.json().catch(() => ({}))) as { db?: string; redis?: string };

    return response.ok
      ? { status: "ok", label, detail: `${apiUrl} healthy` }
      : {
          status: "fail",
          label,
          detail: `${apiUrl} degraded (db: ${body.db ?? "?"}, redis: ${body.redis ?? "?"})`,
          fix: "Check the API server's database and Redis connections."
        };
  } catch {
    return {
      status: "fail",
      label,
      detail: `cannot reach ${apiUrl}`,
      fix: "Start the API, or unset DIDITBREAK_API_URL to run locally."
    };
  }
}

export async function runDoctorChecks(environment: DoctorEnvironment): Promise<CheckResult[]> {
  const { cwd } = environment;
  const results: CheckResult[] = [checkNode(environment.nodeVersion)];

  let config: DiditbreakConfig | null = null;
  try {
    config = await loadConfig(cwd);
    results.push({
      status: "ok",
      label: "Config",
      detail: `diditbreak.config.ts · threshold ${config.threshold}`
    });
  } catch (error) {
    results.push({ status: "fail", label: "Config", ...describeError(error) });
  }

  if (config) {
    results.push(await checkProvider("Generation", config.generationModel, environment));
    results.push(await checkProvider("Judge", config.judgeModel, environment));
  } else {
    results.push({ status: "skip", label: "Models", detail: "skipped until the config loads" });
  }

  let prompts: RegisteredPrompt[] = [];
  try {
    prompts = await loadCurrentPrompts(cwd);
    results.push({
      status: "ok",
      label: "Prompts",
      detail: `${prompts.length} registered (${prompts.map((prompt) => prompt.name).join(", ")})`
    });
  } catch (error) {
    results.push({ status: "fail", label: "Prompts", ...describeError(error) });
  }

  results.push(await checkRegistryInGit(cwd));

  if (config) {
    try {
      const cases = await loadTestCases(cwd, config.testsDir);
      const files = (await readdir(resolve(cwd, config.testsDir))).filter((file) =>
        file.endsWith(".json")
      ).length;
      const deterministic = cases.filter((testCase) => testCase.assert !== undefined).length;

      results.push({
        status: "ok",
        label: "Tests",
        detail: `${cases.length} case${cases.length === 1 ? "" : "s"} in ${files} file${files === 1 ? "" : "s"} · ${deterministic} with zero-cost assertions`
      });

      for (const name of findUnknownScopes(cases, prompts)) {
        results.push({
          status: "warn",
          label: "Tests",
          detail: `cases target "${name}", which is not registered — they will never run`,
          fix: `diditbreak add ${name} <file>, or fix the name in the test file.`
        });
      }
    } catch (error) {
      results.push({ status: "fail", label: "Tests", ...describeError(error) });
    }
  }

  results.push(await checkRemoteApi(environment));

  return results;
}

const ICONS: Record<CheckStatus, string> = {
  ok: chalk.green("✓"),
  warn: chalk.yellow("⚠"),
  fail: chalk.red("✗"),
  skip: chalk.dim("–")
};

export async function runDoctorCommand(): Promise<number> {
  const results = await runDoctorChecks({
    cwd: process.cwd(),
    env: process.env,
    nodeVersion: process.version,
    fetch: globalThis.fetch
  });

  const width = Math.max(...results.map((result) => result.label.length));

  console.log(`\n ${chalk.bold("diditbreak doctor")}\n`);
  for (const result of results) {
    const detail = result.status === "skip" ? chalk.dim(result.detail) : result.detail;
    console.log(` ${ICONS[result.status]} ${result.label.padEnd(width)}  ${detail}`);
    if (result.fix && (result.status === "fail" || result.status === "warn")) {
      console.log(`   ${" ".repeat(width)}  ${chalk.dim("→")} ${chalk.cyan(result.fix)}`);
    }
  }

  const failures = results.filter((result) => result.status === "fail").length;
  const warnings = results.filter((result) => result.status === "warn").length;

  console.log("");
  if (failures > 0) {
    console.log(` ${chalk.red(`${failures} problem${failures === 1 ? "" : "s"}`)} to fix before \`diditbreak test\` will run cleanly.\n`);
    return 1;
  }

  console.log(
    ` ${warnings > 0 ? chalk.yellow(`${warnings} warning${warnings === 1 ? "" : "s"}.`) : chalk.green("All good.")} Ready for \`diditbreak test\`.\n`
  );
  return 0;
}
