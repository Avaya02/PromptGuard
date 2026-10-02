// Agent experiment settings for the demo. Haiku keeps a full comparison
// cheap and fast; swap in "sonnet" for a more capable agent.
export default {
  agent: {
    name: "claude-code",
    model: "haiku",
    maxTurns: 15,
    maxBudgetUsd: 0.5,
    permissionMode: "acceptEdits",
    // Lets the agent run the test suite; anything else needs permission and is denied.
    allowedTools: ["Bash(node:*)"]
  },
  tasks: { trials: 2, concurrency: 3 }
};
