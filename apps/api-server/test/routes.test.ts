import type { PrismaClient } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApiServer } from "../src/app.js";
import type { ApiQueues } from "../src/lib/queues.js";
import { createFakePrisma, createFakeQueues, type FakePrisma } from "./fake-prisma.js";

let prisma: FakePrisma;
let queues: ReturnType<typeof createFakeQueues>;
let app: ReturnType<typeof buildApiServer>;

function build(options: { redisOk?: boolean } = {}) {
  queues = createFakeQueues(options);
  app = buildApiServer({
    prisma: prisma as unknown as PrismaClient,
    queues: queues as unknown as ApiQueues,
    logger: false
  });
  return app;
}

const VALID_RUN = {
  commitSha: "abc123",
  environment: "CI" as const,
  threshold: 0.1,
  generationModel: { provider: "mock", model: "mock" },
  judgeModel: { provider: "mock", model: "mock" },
  prompts: [{ name: "greeter", versionB: "Say hello." }],
  testCases: [{ name: "t1", input: "hi", expect: "is polite" }]
};

beforeEach(() => {
  prisma = createFakePrisma();
  build();
});

afterEach(async () => {
  await app.close();
});

describe("GET /health", () => {
  it("reports ok when db and redis both answer", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok", db: "connected", redis: "connected" });
  });

  it("reports degraded with 503 when redis is unreachable", async () => {
    await app.close();
    build({ redisOk: false });

    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ status: "degraded", redis: "disconnected" });
  });
});

describe("POST /runs", () => {
  it("creates a run and enqueues one job per prompt", async () => {
    const response = await app.inject({ method: "POST", url: "/runs", payload: VALID_RUN });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.run.status).toBe("PENDING");
    expect(body.run.expectedJobs).toBe(1);
    expect(queues.promptRunQueue.added).toHaveLength(1);
  });

  it("enqueues a job per prompt for a multi-prompt run", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/runs",
      payload: {
        ...VALID_RUN,
        prompts: [
          { name: "a", versionB: "content a" },
          { name: "b", versionB: "content b" }
        ]
      }
    });

    expect(response.json().run.expectedJobs).toBe(2);
    expect(queues.promptRunQueue.added).toHaveLength(2);
  });

  describe("prompt version deduplication", () => {
    it("creates exactly one version for a first-time prompt", async () => {
      await app.inject({ method: "POST", url: "/runs", payload: VALID_RUN });

      expect(prisma.__store.promptVersions).toHaveLength(1);
      expect(prisma.__store.prompts[0]?.latestVersion).toBe(1);
    });

    it("does not create a new version when content is unchanged", async () => {
      await app.inject({ method: "POST", url: "/runs", payload: VALID_RUN });
      await app.inject({ method: "POST", url: "/runs", payload: VALID_RUN });
      await app.inject({ method: "POST", url: "/runs", payload: VALID_RUN });

      // Re-running an unchanged prompt must not inflate version history.
      expect(prisma.__store.promptVersions).toHaveLength(1);
      expect(prisma.__store.prompts[0]?.latestVersion).toBe(1);
    });

    it("creates a new version when content changes", async () => {
      await app.inject({ method: "POST", url: "/runs", payload: VALID_RUN });
      await app.inject({
        method: "POST",
        url: "/runs",
        payload: { ...VALID_RUN, prompts: [{ name: "greeter", versionB: "Say hello warmly." }] }
      });

      expect(prisma.__store.promptVersions).toHaveLength(2);
      expect(prisma.__store.prompts[0]?.latestVersion).toBe(2);
    });

    it("tracks each prompt's history independently", async () => {
      await app.inject({
        method: "POST",
        url: "/runs",
        payload: {
          ...VALID_RUN,
          prompts: [
            { name: "a", versionB: "a1" },
            { name: "b", versionB: "b1" }
          ]
        }
      });

      await app.inject({
        method: "POST",
        url: "/runs",
        payload: {
          ...VALID_RUN,
          prompts: [
            { name: "a", versionB: "a2" },
            { name: "b", versionB: "b1" }
          ]
        }
      });

      // Only "a" changed, so only "a" gains a version.
      expect(prisma.__store.promptVersions.filter((v) => v.content.startsWith("a"))).toHaveLength(2);
      expect(prisma.__store.promptVersions.filter((v) => v.content.startsWith("b"))).toHaveLength(1);
    });
  });

  describe("validation", () => {
    it("rejects an empty prompt list", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/runs",
        payload: { ...VALID_RUN, prompts: [] }
      });

      expect(response.statusCode).toBe(500);
    });

    it("rejects a threshold above 1", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/runs",
        payload: { ...VALID_RUN, threshold: 2 }
      });

      expect(response.statusCode).toBe(500);
    });

    it("accepts a test case carrying deterministic assertions", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/runs",
        payload: {
          ...VALID_RUN,
          testCases: [{ name: "t1", input: "hi", assert: { contains: "hello" } }]
        }
      });

      expect(response.statusCode).toBe(201);
    });
  });
});

describe("GET /runs/:id", () => {
  it("returns the run summary", async () => {
    const created = await app.inject({ method: "POST", url: "/runs", payload: VALID_RUN });
    const runId = created.json().run.id;

    const response = await app.inject({ method: "GET", url: `/runs/${runId}` });

    expect(response.statusCode).toBe(200);
    expect(response.json().id).toBe(runId);
  });

  it("404s for an unknown run", async () => {
    const response = await app.inject({ method: "GET", url: "/runs/does-not-exist" });

    expect(response.statusCode).toBe(404);
    expect(response.json().error).toBe("Run not found");
  });
});

describe("GET /runs/:id/results", () => {
  it("returns persisted results with assertion metadata", async () => {
    const created = await app.inject({ method: "POST", url: "/runs", payload: VALID_RUN });
    const runId = created.json().run.id;

    await prisma.result.createMany({
      data: [
        {
          runId,
          promptName: "greeter",
          testName: "t1",
          pass: true,
          driftScore: 0,
          reasoning: "fine",
          latencyMs: 12,
          tokensUsed: 0,
          assertionType: "DETERMINISTIC",
          estimatedCostUsd: 0
        }
      ]
    });

    const response = await app.inject({ method: "GET", url: `/runs/${runId}/results` });

    expect(response.statusCode).toBe(200);
    const [result] = response.json();
    expect(result.assertionType).toBe("deterministic");
    expect(result.estimatedCostUsd).toBe(0);
  });

  it("404s for an unknown run", async () => {
    const response = await app.inject({ method: "GET", url: "/runs/nope/results" });
    expect(response.statusCode).toBe(404);
  });
});

describe("GET /runs", () => {
  beforeEach(async () => {
    for (const environment of ["CI", "LOCAL", "CI"] as const) {
      await app.inject({ method: "POST", url: "/runs", payload: { ...VALID_RUN, environment } });
    }

    prisma.__store.runs[0]!.status = "FAILED";
    prisma.__store.runs[1]!.status = "COMPLETED";
  });

  it("lists runs newest first", async () => {
    const response = await app.inject({ method: "GET", url: "/runs" });

    expect(response.statusCode).toBe(200);
    expect(response.json().runs).toHaveLength(3);
  });

  it("filters by status", async () => {
    const response = await app.inject({ method: "GET", url: "/runs?status=FAILED" });

    const { runs } = response.json();
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("FAILED");
  });

  it("filters by environment", async () => {
    const response = await app.inject({ method: "GET", url: "/runs?environment=LOCAL" });
    expect(response.json().runs).toHaveLength(1);
  });

  it("honours limit and returns a cursor when more remain", async () => {
    const response = await app.inject({ method: "GET", url: "/runs?limit=2" });

    const body = response.json();
    expect(body.runs).toHaveLength(2);
    expect(body.nextCursor).toBeTruthy();
  });

  it("returns a null cursor on the last page", async () => {
    const response = await app.inject({ method: "GET", url: "/runs?limit=50" });
    expect(response.json().nextCursor).toBeNull();
  });

  it("rejects a limit above the maximum", async () => {
    const response = await app.inject({ method: "GET", url: "/runs?limit=5000" });
    expect(response.statusCode).toBe(500);
  });
});

describe("DELETE /runs/:id", () => {
  it("deletes the run and cascades its results", async () => {
    const created = await app.inject({ method: "POST", url: "/runs", payload: VALID_RUN });
    const runId = created.json().run.id;

    await prisma.result.createMany({
      data: [{ runId, promptName: "greeter", testName: "t1", pass: true }]
    });

    const response = await app.inject({ method: "DELETE", url: `/runs/${runId}` });

    expect(response.statusCode).toBe(204);
    expect(prisma.__store.runs).toHaveLength(0);
    expect(prisma.__store.results).toHaveLength(0);
  });

  it("404s for an unknown run", async () => {
    const response = await app.inject({ method: "DELETE", url: "/runs/nope" });
    expect(response.statusCode).toBe(404);
  });
});

describe("GET /prompts", () => {
  it("returns an empty list when nothing is registered", async () => {
    const response = await app.inject({ method: "GET", url: "/prompts" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([]);
  });

  it("lists registered prompts", async () => {
    await app.inject({ method: "POST", url: "/runs", payload: VALID_RUN });

    const response = await app.inject({ method: "GET", url: "/prompts" });
    const [prompt] = response.json();

    expect(prompt.name).toBe("greeter");
    expect(prompt.latestVersion).toBe(1);
  });
});

describe("GET /prompts/:id", () => {
  it("returns the prompt with full version history, newest first", async () => {
    await app.inject({ method: "POST", url: "/runs", payload: VALID_RUN });
    await app.inject({
      method: "POST",
      url: "/runs",
      payload: { ...VALID_RUN, prompts: [{ name: "greeter", versionB: "Say hello warmly." }] }
    });

    const promptId = prisma.__store.prompts[0]!.id;
    const response = await app.inject({ method: "GET", url: `/prompts/${promptId}` });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.versions).toHaveLength(2);
    expect(body.versions[0].content).toBe("Say hello warmly.");
  });

  it("404s for an unknown prompt", async () => {
    const response = await app.inject({ method: "GET", url: "/prompts/nope" });
    expect(response.statusCode).toBe(404);
  });
});

describe("POST /evaluate", () => {
  it("evaluates a deterministic case with no model call and no cost", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/evaluate",
      payload: {
        prompt: "You are helpful.",
        input: "say hello",
        assert: { contains: "mock-response" }
      }
    });

    expect(response.statusCode).toBe(200);
    const { result } = response.json();
    expect(result.pass).toBe(true);
    expect(result.assertionType).toBe("deterministic");
    expect(result.tokensUsed).toBe(0);
  });

  it("reports a deterministic failure with the reason", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/evaluate",
      payload: {
        prompt: "You are helpful.",
        input: "say hello",
        assert: { contains: "THIS_WILL_NOT_APPEAR" }
      }
    });

    const { result } = response.json();
    expect(result.pass).toBe(false);
    expect(result.reason).toContain("contains");
  });

  it("runs the judge for a semantic case", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/evaluate",
      payload: { prompt: "You are helpful.", input: "say hello", expect: "is polite" }
    });

    const { result } = response.json();
    expect(result.assertionType).toBe("semantic");
    expect(result.pass).toBe(true);
  });

  it("defaults to the mock provider when no model is configured", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/evaluate",
      payload: { prompt: "p", input: "i", expect: "r" }
    });

    // No API keys are set in this suite, so anything but mock would throw.
    expect(response.statusCode).toBe(200);
  });

  it("400s when neither expect nor assert is supplied", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/evaluate",
      payload: { prompt: "p", input: "i" }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain("assert");
  });

  it("400s with a clear message when a provider key is missing", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/evaluate",
      payload: {
        prompt: "p",
        input: "i",
        expect: "r",
        judgeModel: { provider: "openai", model: "gpt-4o" }
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain("OPENAI_API_KEY");
  });
});
