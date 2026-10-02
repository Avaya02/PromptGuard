import type { AgentEnvironment, AgentRunResult, ToolCall } from "../types.js";

interface Usage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

interface ContentBlock {
  type?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  text?: string;
}

interface StreamEvent {
  type?: string;
  subtype?: string;
  // init
  model?: string;
  claude_code_version?: string;
  skills?: string[];
  agents?: string[];
  mcp_servers?: Array<{ name?: string }>;
  // assistant
  message?: { id?: string; content?: ContentBlock[]; usage?: Usage };
  // result
  is_error?: boolean;
  num_turns?: number;
  duration_ms?: number;
  total_cost_usd?: number;
  usage?: Usage;
  result?: string;
  permission_denials?: unknown[];
}

function promptTokens(usage: Usage | undefined): number {
  if (!usage) {
    return 0;
  }
  return (
    (usage.input_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0)
  );
}

/**
 * Turns Claude Code's `--output-format stream-json` transcript into a result.
 *
 * Pure, so it is tested against real captured transcripts. Assistant messages
 * arrive as several events sharing one message id (one per content block), so
 * tool calls are de-duplicated by block id and token usage by message id.
 */
export function parseClaudeStream(jsonl: string): AgentRunResult {
  const events: StreamEvent[] = [];
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    try {
      events.push(JSON.parse(line) as StreamEvent);
    } catch {
      // A truncated final line (the process was killed mid-write) is expected.
    }
  }

  const init = events.find((event) => event.type === "system" && event.subtype === "init");
  const environment: AgentEnvironment = {
    ...(init?.model !== undefined ? { model: init.model } : {}),
    ...(init?.claude_code_version !== undefined ? { version: init.claude_code_version } : {}),
    skillsLoaded: init?.skills ?? [],
    mcpServers: (init?.mcp_servers ?? []).map((server) => server.name ?? "").filter(Boolean),
    agents: init?.agents ?? []
  };

  const toolCalls: ToolCall[] = [];
  const seenBlocks = new Set<string>();
  const seenMessages = new Set<string>();
  let contextTokens: number | null = null;
  let lastText = "";

  for (const event of events) {
    if (event.type !== "assistant" || !event.message) {
      continue;
    }

    const messageId = event.message.id;
    if (messageId && !seenMessages.has(messageId)) {
      seenMessages.add(messageId);
      // The first model call's prompt is the context carried before any work.
      if (contextTokens === null && event.message.usage) {
        contextTokens = promptTokens(event.message.usage);
      }
    }

    for (const block of event.message.content ?? []) {
      if (block.type === "text" && block.text) {
        lastText = block.text;
      }
      if (block.type !== "tool_use" || !block.name) {
        continue;
      }
      const key = block.id ?? `${messageId}:${toolCalls.length}`;
      if (seenBlocks.has(key)) {
        continue;
      }
      seenBlocks.add(key);
      toolCalls.push({ name: block.name, input: block.input ?? {} });
    }
  }

  const skillsUsed = toolCalls
    .filter((call) => call.name === "Skill" && typeof call.input.skill === "string")
    .map((call) => call.input.skill as string);

  const commands = toolCalls
    .filter((call) => call.name === "Bash" && typeof call.input.command === "string")
    .map((call) => call.input.command as string);

  const result = events.find((event) => event.type === "result");

  if (!result) {
    return {
      completed: false,
      error: "the agent exited without a result (crashed, or was killed)",
      finalMessage: lastText,
      turns: seenMessages.size,
      durationMs: 0,
      costUsd: null,
      inputTokens: 0,
      outputTokens: 0,
      contextTokens,
      toolCalls,
      skillsUsed,
      commands,
      permissionDenials: 0,
      environment
    };
  }

  const succeeded = result.subtype === "success" && result.is_error !== true;

  return {
    completed: succeeded,
    // Subtypes such as error_max_turns name the limit that stopped the agent.
    ...(succeeded ? {} : { error: result.subtype ?? "error" }),
    finalMessage: typeof result.result === "string" ? result.result : lastText,
    turns: result.num_turns ?? seenMessages.size,
    durationMs: result.duration_ms ?? 0,
    costUsd: typeof result.total_cost_usd === "number" ? result.total_cost_usd : null,
    inputTokens: promptTokens(result.usage),
    outputTokens: result.usage?.output_tokens ?? 0,
    contextTokens,
    toolCalls,
    skillsUsed,
    commands,
    permissionDenials: result.permission_denials?.length ?? 0,
    environment
  };
}
