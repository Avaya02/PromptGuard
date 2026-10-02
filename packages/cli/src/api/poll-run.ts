import type { Ora } from "ora";

import type { RunSummary } from "@diditbreak/shared-types";

import { fetchRemoteRun } from "./client.js";

function isTerminal(status: RunSummary["status"]): boolean {
  return status === "COMPLETED" || status === "FAILED";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export const DEFAULT_POLL_INTERVAL_MS = 1500;

export async function waitForRunCompletion(
  apiUrl: string,
  runId: string,
  spinner: Ora,
  timeoutMs = 10 * 60 * 1000,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS
): Promise<RunSummary> {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const run = await fetchRemoteRun(apiUrl, runId);
    spinner.text = `Run ${run.id}: ${run.status} (${run.completedJobs}/${run.expectedJobs})`;

    if (isTerminal(run.status)) {
      return run;
    }

    await sleep(pollIntervalMs);
  }

  throw new Error(`Run polling timed out after ${timeoutMs}ms`);
}
