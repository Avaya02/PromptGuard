import type { PromptEvaluationResult } from "@promptguard/evaluator";
import {
  selectCasesForPrompt,
  type CreateRunRequest,
  type RunResultRecord
} from "@promptguard/shared-types";
import type { Ora } from "ora";

import type { TestModeContext } from "./test-command.js";
import { createRemoteRun, fetchRemoteRunResults } from "../api/client.js";
import { waitForRunCompletion } from "../api/poll-run.js";
import { resolveCommitSha } from "../git/resolve-commit-sha.js";

function toPromptResults(
  promptNames: string[],
  records: RunResultRecord[],
  threshold: number
): PromptEvaluationResult[] {
  const grouped = new Map<string, RunResultRecord[]>();

  for (const record of records) {
    const items = grouped.get(record.promptName) ?? [];
    items.push(record);
    grouped.set(record.promptName, items);
  }

  return promptNames.map((promptName) => {
    const items = grouped.get(promptName) ?? [];

    if (items.length === 0) {
      return {
        promptName,
        pass: false,
        driftScore: 1,
        failedTests: 1,
        totalTests: 1,
        results: [
          {
            testName: "remote-run",
            pass: false,
            driftScore: 1,
            reason: "No results were returned for this prompt.",
            latencyMs: 0,
            tokensUsed: 0,
            assertionType: "semantic"
          }
        ]
      };
    }

    const failedTests = items.filter((item) => !item.pass).length;
    const totalTests = items.length;
    const driftScore = totalTests === 0 ? 0 : failedTests / totalTests;

    return {
      promptName,
      pass: driftScore <= threshold,
      driftScore,
      failedTests,
      totalTests,
      results: items.map((item) => ({
        testName: item.testName,
        pass: item.pass,
        driftScore: item.driftScore,
        reason: item.reasoning,
        latencyMs: item.latencyMs,
        tokensUsed: item.tokensUsed,
        assertionType: item.assertionType,
        ...(item.estimatedCostUsd !== null ? { estimatedCostUsd: item.estimatedCostUsd } : {})
      }))
    };
  });
}

/** Prompts with at least one applicable case; the rest would only produce empty jobs. */
function promptsInScope(context: TestModeContext) {
  return context.currentPrompts.filter(
    (prompt) => selectCasesForPrompt(context.testCases, prompt.name).length > 0
  );
}

function buildCreateRunRequest(context: TestModeContext, commitSha: string): CreateRunRequest {
  return {
    commitSha,
    environment: process.env.CI ? "CI" : "LOCAL",
    threshold: context.config.threshold,
    generationModel: context.config.generationModel,
    judgeModel: context.config.judgeModel,
    prompts: promptsInScope(context).map((prompt) => ({
      name: prompt.name,
      versionB: prompt.content,
      ...(context.baselineByName.has(prompt.name)
        ? { versionA: context.baselineByName.get(prompt.name) }
        : {})
    })),
    testCases: context.testCases
  };
}

export async function runRemoteMode(
  apiUrl: string,
  spinner: Ora,
  context: TestModeContext
): Promise<{ status: "COMPLETED" | "FAILED"; results: PromptEvaluationResult[] }> {
  const commitSha = await resolveCommitSha(context.cwd);
  const payload = buildCreateRunRequest(context, commitSha);

  spinner.text = "Submitting run to PromptGuard API";
  const created = await createRemoteRun(apiUrl, payload);

  spinner.text = `Waiting for remote run ${created.run.id}`;
  const run = await waitForRunCompletion(apiUrl, created.run.id, spinner);

  spinner.text = "Fetching remote results";
  const records = await fetchRemoteRunResults(apiUrl, created.run.id);

  return {
    status: run.status === "FAILED" ? "FAILED" : "COMPLETED",
    results: toPromptResults(
      promptsInScope(context).map((prompt) => prompt.name),
      records,
      context.config.threshold
    )
  };
}
