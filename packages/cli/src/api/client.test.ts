import { afterEach, describe, expect, it, vi } from "vitest";

import { createRemoteRun, fetchRemoteRun, fetchRemoteRunResults } from "./client.js";
import { waitForRunCompletion } from "./poll-run.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function runSummary(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    commitSha: "abc",
    environment: "CI",
    score: null,
    status: "PENDING",
    expectedJobs: 1,
    completedJobs: 0,
    failedJobs: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

const PAYLOAD = {
  commitSha: "abc",
  environment: "CI" as const,
  threshold: 0.1,
  generationModel: { provider: "mock", model: "mock" },
  judgeModel: { provider: "mock", model: "mock" },
  prompts: [{ name: "greeter", versionB: "Say hello." }],
  testCases: [{ name: "t1", input: "hi", expect: "polite" }]
};

describe("createRemoteRun", () => {
  it("POSTs JSON and parses the response", async () => {
    const calls: Parameters<typeof fetch>[] = [];
    globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
      calls.push(args);
      return jsonResponse({ run: runSummary() });
    }) as typeof fetch;

    const result = await createRemoteRun("http://api.test", PAYLOAD);

    expect(result.run.id).toBe("run-1");
    expect(String(calls[0]![0])).toBe("http://api.test/runs");
    expect((calls[0]![1] as RequestInit).method).toBe("POST");
  });

  it("throws with the status code on a non-2xx response", async () => {
    globalThis.fetch = vi.fn(async () => new Response("nope", { status: 500 })) as typeof fetch;

    await expect(createRemoteRun("http://api.test", PAYLOAD)).rejects.toThrow(/500/);
  });

  it("rejects a response that violates the schema", async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({ run: { id: "x" } })) as typeof fetch;

    await expect(createRemoteRun("http://api.test", PAYLOAD)).rejects.toThrow();
  });
});

describe("fetchRemoteRun", () => {
  it("parses a run summary", async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse(runSummary({ status: "COMPLETED" }))
    ) as typeof fetch;

    expect((await fetchRemoteRun("http://api.test", "run-1")).status).toBe("COMPLETED");
  });

  it("throws on 404", async () => {
    globalThis.fetch = vi.fn(async () => new Response("", { status: 404 })) as typeof fetch;
    await expect(fetchRemoteRun("http://api.test", "nope")).rejects.toThrow(/404/);
  });
});

describe("fetchRemoteRunResults", () => {
  it("defaults assertionType and cost for an older API response", async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse([
        {
          id: "r1",
          runId: "run-1",
          promptName: "greeter",
          testName: "t1",
          pass: true,
          driftScore: 0,
          reasoning: "ok",
          latencyMs: 5,
          tokensUsed: 2,
          createdAt: new Date().toISOString()
        }
      ])
    ) as typeof fetch;

    const [record] = await fetchRemoteRunResults("http://api.test", "run-1");

    // Forward compatibility: a server predating these fields must still parse.
    expect(record?.assertionType).toBe("semantic");
    expect(record?.estimatedCostUsd).toBeNull();
  });

  it("preserves an explicit deterministic assertionType", async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse([
        {
          id: "r1",
          runId: "run-1",
          promptName: "greeter",
          testName: "t1",
          pass: true,
          driftScore: 0,
          reasoning: "ok",
          latencyMs: 5,
          tokensUsed: 0,
          assertionType: "deterministic",
          estimatedCostUsd: 0,
          createdAt: new Date().toISOString()
        }
      ])
    ) as typeof fetch;

    const [record] = await fetchRemoteRunResults("http://api.test", "run-1");
    expect(record?.assertionType).toBe("deterministic");
  });
});

describe("waitForRunCompletion", () => {
  const spinner = { text: "" } as { text: string };

  it("returns as soon as the run reaches COMPLETED", async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls += 1;
      return jsonResponse(runSummary({ status: calls < 3 ? "RUNNING" : "COMPLETED" }));
    }) as typeof fetch;

    const run = await waitForRunCompletion("http://api.test", "run-1", spinner as never, 60_000, 1);

    expect(run.status).toBe("COMPLETED");
    expect(calls).toBe(3);
  });

  it("treats FAILED as terminal", async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse(runSummary({ status: "FAILED" }))
    ) as typeof fetch;

    expect(
      (await waitForRunCompletion("http://api.test", "r", spinner as never, 60_000, 1)).status
    ).toBe(
      "FAILED"
    );
  });

  it("updates the spinner with progress", async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse(runSummary({ status: "COMPLETED", completedJobs: 2, expectedJobs: 3 }))
    ) as typeof fetch;

    await waitForRunCompletion("http://api.test", "run-1", spinner as never, 60_000, 1);
    expect(spinner.text).toContain("2/3");
  });

  it("times out rather than polling forever", async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse(runSummary({ status: "RUNNING" }))
    ) as typeof fetch;

    await expect(
      waitForRunCompletion("http://api.test", "run-1", spinner as never, 10, 1)
    ).rejects.toThrow(/timed out/);
  });
});
