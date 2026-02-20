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
