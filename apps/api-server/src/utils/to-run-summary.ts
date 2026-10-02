import type { RunSummary } from "@diditbreak/shared-types";

interface RunRecord {
  id: string;
  commitSha: string;
  environment: "LOCAL" | "CI" | "PROD";
  score: number | null;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
  expectedJobs: number;
  completedJobs: number;
  failedJobs: number;
  createdAt: Date;
  updatedAt: Date;
}

export function toRunSummary(run: RunRecord): RunSummary {
  return {
    id: run.id,
    commitSha: run.commitSha,
    environment: run.environment,
    score: run.score,
    status: run.status,
    expectedJobs: run.expectedJobs,
    completedJobs: run.completedJobs,
    failedJobs: run.failedJobs,
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString()
  };
}
