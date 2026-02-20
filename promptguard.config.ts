export default {
  threshold: 0.1,
  testsDir: "prompt_tests",
  generationModel: {
    provider: "local",
    model: "llama3"
  },
  judgeModel: {
    provider: "openai",
    model: "gpt-4o"
  }
};
