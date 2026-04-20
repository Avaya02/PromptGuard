import type { RunResultRecord, RunSummary, RunViewResponse } from "@promptguard/shared-types";

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
