// PromptGuard's own regression suite, used by CI as a self-test.
// MockProvider is deterministic and offline, so this runs at zero cost.
export default {
  threshold: 0.1,
  testsDir: "prompt_tests",
  concurrency: 5,
  generationModel: { provider: "mock", model: "mock" },
  judgeModel: { provider: "mock", model: "mock" }
};
