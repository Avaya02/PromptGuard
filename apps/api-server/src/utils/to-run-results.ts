import type { RunResultRecord } from "@promptguard/shared-types";

interface ResultRow {
  id: string;
  runId: string;
  promptName: string;
  testName: string;
  pass: boolean;
  driftScore: number;
  reasoning: string;
  latencyMs: number;
  tokensUsed: number;
  createdAt: Date;
}

export function toRunResultRecords(rows: ResultRow[]): RunResultRecord[] {
  return rows.map((row) => ({
    id: row.id,
    runId: row.runId,
    promptName: row.promptName,
    testName: row.testName,
    pass: row.pass,
    driftScore: row.driftScore,
    reasoning: row.reasoning,
    latencyMs: row.latencyMs,
    tokensUsed: row.tokensUsed,
    createdAt: row.createdAt.toISOString()
  }));
}
