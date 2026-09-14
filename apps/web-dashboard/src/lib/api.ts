import { apiBaseUrl } from "./env";
import type {
  EvaluateRequest,
  EvaluateResponse,
  PromptDetail,
  PromptListItem,
  PromptRunsResponse,
  RunResultsResponse,
  RunViewApiResponse
} from "./types";

/** Error carrying the HTTP status so the UI can explain what went wrong. */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${apiBaseUrl}${path}`, init);
  } catch {
    // fetch only rejects on a transport failure, which almost always means the
    // API is not running or CORS blocked the call.
    throw new ApiError(0, `Could not reach the API at ${apiBaseUrl}`);
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(response.status, body?.error ?? `Request failed (${response.status})`);
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

export function getPromptDetail(promptId: string): Promise<PromptDetail> {
  return fetchJson<PromptDetail>(`/prompts/${promptId}`);
}

export function evaluatePrompt(payload: EvaluateRequest): Promise<EvaluateResponse> {
  return fetchJson<EvaluateResponse>("/evaluate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
}
