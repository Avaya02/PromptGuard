export interface ModelConfig {
  provider: string;
  model: string;
  baseUrl?: string;
  apiKeyEnvVar?: string;
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
  responseA?: string;
  responseB: string;
  expect?: string | null;
}

export interface JudgeResult {
  pass: boolean;
  reason: string;
  drift: number;
  raw?: string;
  latencyMs?: number;
  tokensUsed?: number;
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
