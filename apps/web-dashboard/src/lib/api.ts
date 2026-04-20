import { apiBaseUrl } from "./env";
import type {
  PromptListItem,
  PromptRunsResponse,
  RunResultsResponse,
  RunViewApiResponse
} from "./types";

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`);

  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${path}`);
  }

  return (await response.json()) as T;
}

export function getPrompts(): Promise<PromptListItem[]> {
  return fetchJson<PromptListItem[]>("/prompts");
}

export function getPromptRuns(promptId: string): Promise<PromptRunsResponse> {
  return fetchJson<PromptRunsResponse>(`/prompts/${promptId}/runs`);
}

export function getRunResults(runId: string): Promise<RunResultsResponse> {
  return fetchJson<RunResultsResponse>(`/runs/${runId}/results`);
}

export function getRunView(runId: string): Promise<RunViewApiResponse> {
  return fetchJson<RunViewApiResponse>(`/runs/${runId}/view`);
}
