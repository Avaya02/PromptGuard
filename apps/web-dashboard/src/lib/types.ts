import type {
  CaseEvaluationResult,
  RunResultRecord,
  RunSummary,
  RunViewResponse
} from "@promptguard/shared-types";

export interface PromptListItem {
  id: string;
  name: string;
  latestVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface ApiErrorResponse {
  error: string;
}

export type PromptRunsResponse = RunSummary[];
export type RunResultsResponse = RunResultRecord[];
export type RunViewApiResponse = RunViewResponse;

export interface PromptVersionRecord {
  id: string;
  commitSha: string;
  content: string;
  hash: string;
  createdAt: string;
}

export interface PromptDetail extends PromptListItem {
  versions: PromptVersionRecord[];
}

export interface EvaluateRequest {
  prompt: string;
  input: string;
  expect?: string | null;
  assert?: Record<string, unknown>;
}

export interface EvaluateResponse {
  result: CaseEvaluationResult;
}

export interface RunListResponse {
  runs: RunSummary[];
  nextCursor: string | null;
}
