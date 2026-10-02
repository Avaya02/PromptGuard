import type {
  CreateRunRequest,
  CreateRunResponse,
  RunResultRecord,
  RunSummary
} from "@diditbreak/shared-types";

import { createRunResponseSchema, runResultsSchema, runSummarySchema } from "./schemas.js";

async function requestJson(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, init);

  if (!response.ok) {
    throw new Error(`API request failed (${response.status}) ${url}`);
  }

  return response.json();
}

export async function createRemoteRun(
  apiUrl: string,
  payload: CreateRunRequest
): Promise<CreateRunResponse> {
  const json = await requestJson(`${apiUrl}/runs`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  return createRunResponseSchema.parse(json);
}

export async function fetchRemoteRun(apiUrl: string, runId: string): Promise<RunSummary> {
  const json = await requestJson(`${apiUrl}/runs/${runId}`);
  return runSummarySchema.parse(json);
}

export async function fetchRemoteRunResults(
  apiUrl: string,
  runId: string
): Promise<RunResultRecord[]> {
  const json = await requestJson(`${apiUrl}/runs/${runId}/results`);
  return runResultsSchema.parse(json);
}
