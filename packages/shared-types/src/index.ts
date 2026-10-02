import { z } from "zod";

export interface ModelConfig {
  provider: string;
  model: string;
  baseUrl?: string | undefined;
  apiKeyEnvVar?: string | undefined;
}

export interface DiditbreakConfig {
  threshold: number;
  testsDir: string;
  generationModel: ModelConfig;
  judgeModel: ModelConfig;
  /** Max cases evaluated in parallel. Defaults to 5 when omitted. */
  concurrency?: number | undefined;
}

export interface RegisteredPrompt {
  name: string;
  content: string;
  hash: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Deterministic checks evaluated locally, before any model call.
 *
 * Every field is optional; a case may combine several. All present checks must
 * pass for the case to proceed to the (paid) LLM judge.
 */
export const assertionSchema = z
  .object({
    contains: z.union([z.string(), z.array(z.string())]).optional(),
    not_contains: z.union([z.string(), z.array(z.string())]).optional(),
    regex: z.string().optional(),
    json_schema: z.record(z.unknown()).optional(),
    max_latency_ms: z.number().int().positive().optional()
  })
  .strict();

export type Assertion = z.infer<typeof assertionSchema>;

export interface TestCase {
  input: string;
  /** LLM judge rubric. Null/absent means deterministic-only. */
  expect?: string | null | undefined;
  /** Deterministic, zero-token checks run before the judge. */
  assert?: Assertion | undefined;
  /** Prompt names this case applies to. Absent means every registered prompt. */
  prompts?: string[] | undefined;
}

export interface TestCases {
  cases: TestCase[];
}

/** Which layer decided a case's outcome. */
export type AssertionType = "deterministic" | "semantic";

export interface JudgeInput {
  input: string;
  responseA?: string | undefined;
  responseB: string;
  expect?: string | null | undefined;
}

export interface JudgeResult {
  pass: boolean;
  reason: string;
  drift: number;
  raw?: string | undefined;
  latencyMs?: number | undefined;
  tokensUsed?: number | undefined;
  estimatedCostUsd?: number | undefined;
}

export interface CaseEvaluationResult {
  testName: string;
  pass: boolean;
  driftScore: number;
  reason: string;
  latencyMs: number;
  tokensUsed: number;
  /**
   * "deterministic" when a local assertion decided the outcome (no model call
   * was made); "semantic" when the LLM judge did.
   */
  assertionType: AssertionType;
  estimatedCostUsd?: number | undefined;
}

export interface EvaluationResult {
  pass: boolean;
  driftScore: number;
  failedTests: number;
  totalTests: number;
  results: CaseEvaluationResult[];
}

export type RunEnvironment = "LOCAL" | "CI" | "PROD";
export type RunStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";

export interface NamedTestCase extends TestCase {
  name: string;
}

/**
 * Narrows a suite to the cases that apply to one prompt.
 *
 * Shared by the CLI and the API so local and remote runs scope cases the same
 * way; an SQL-generator case must never be scored against a support agent.
 */
export function selectCasesForPrompt<T extends TestCase>(cases: T[], promptName: string): T[] {
  return cases.filter(
    (testCase) => testCase.prompts === undefined || testCase.prompts.includes(promptName)
  );
}

export interface RunPromptInput {
  name: string;
  versionA?: string | undefined;
  versionB: string;
}

export interface CreateRunRequest {
  commitSha: string;
  environment: RunEnvironment;
  threshold: number;
  generationModel: ModelConfig;
  judgeModel: ModelConfig;
  prompts: RunPromptInput[];
  testCases: NamedTestCase[];
}

export interface RunSummary {
  id: string;
  commitSha: string;
  environment: RunEnvironment;
  score: number | null;
  status: RunStatus;
  expectedJobs: number;
  completedJobs: number;
  failedJobs: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateRunResponse {
  run: RunSummary;
}

export interface RunResultRecord {
  id: string;
  runId: string;
  promptName: string;
  testName: string;
  pass: boolean;
  driftScore: number;
  reasoning: string;
  latencyMs: number;
  tokensUsed: number;
  assertionType: AssertionType;
  estimatedCostUsd: number | null;
  createdAt: string;
}

export interface PromptDiffRecord {
  promptName: string;
  before: string | null;
  after: string;
}

export interface RunViewResponse {
  run: RunSummary;
  results: RunResultRecord[];
  promptDiffs: PromptDiffRecord[];
}

export interface PromptRunJobPayload {
  runId: string;
  prompt: RunPromptInput;
  testCases: NamedTestCase[];
  threshold: number;
  generationModel: ModelConfig;
  judgeModel: ModelConfig;
}

export type JudgeRunJobPayload = PromptRunJobPayload;

export const QUEUE_NAMES = {
  promptRun: "prompt-run",
  judgeRun: "judge-run",
  scoreRun: "score-run"
} as const;
