export interface ModelConfig {
  provider: string;
  model: string;
  baseUrl?: string | undefined;
  apiKeyEnvVar?: string | undefined;
}

export interface PromptGuardConfig {
  threshold: number;
  testsDir: string;
  generationModel: ModelConfig;
  judgeModel: ModelConfig;
}

export interface RegisteredPrompt {
  name: string;
  content: string;
  hash: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface TestCase {
  input: string;
  expect: string | null;
}

export interface TestCases {
  cases: TestCase[];
}

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
}

export interface CaseEvaluationResult {
  testName: string;
  pass: boolean;
  driftScore: number;
  reason: string;
  latencyMs: number;
  tokensUsed: number;
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
  createdAt: string;
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
