import type { PrismaClient } from "@prisma/client";
import type { PromptRunJobPayload } from "@diditbreak/shared-types";
import type { Queue } from "bullmq";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { markPromptCompleted, markPromptFailed } from "../src/services/finalize-run.js";
import { reconcileStuckRuns, RUN_TIMEOUT_MS } from "../src/services/reconcile-runs.js";
import { processJudgeRunJob } from "../src/workers/judge-run-worker.js";
import { processPromptRunJob } from "../src/workers/prompt-run-worker.js";
import { createFakePrisma, type FakePrisma } from "../../api-server/test/fake-prisma.js";

let prisma: FakePrisma;

function asPrisma(client: FakePrisma): PrismaClient {
  return client as unknown as PrismaClient;
}

async function seedRun(expectedJobs: number, overrides: Record<string, unknown> = {}) {
  const run = await prisma.run.create({
    data: { commitSha: "abc", environment: "CI", status: "PENDING", expectedJobs }
  });
  Object.assign(run, overrides);
  return run;
}

const PAYLOAD: PromptRunJobPayload = {
  runId: "",
  prompt: { name: "greeter", versionB: "Say hello." },
  testCases: [{ name: "t1", input: "hi", expect: "is polite" }],
  threshold: 0.1,
  generationModel: { provider: "mock", model: "mock" },
  judgeModel: { provider: "mock", model: "mock" }
};

beforeEach(() => {
  prisma = createFakePrisma();
});

describe("processPromptRunJob", () => {
  it("moves the run to RUNNING and sets a timeout deadline", async () => {
    const run = await seedRun(1);
    const judgeRunQueue = { add: vi.fn(async () => {}) } as unknown as Queue;

    const before = Date.now();
    await processPromptRunJob({ ...PAYLOAD, runId: run.id }, {
      prisma: asPrisma(prisma),
      judgeRunQueue
    });

    const updated = prisma.__store.runs[0]!;
    expect(updated.status).toBe("RUNNING");
    expect(updated.startedAt).toBeInstanceOf(Date);
    expect(updated.timeoutAt!.getTime()).toBeGreaterThanOrEqual(before + RUN_TIMEOUT_MS - 50);
  });

  it("forwards the payload to the judge queue", async () => {
    const run = await seedRun(1);
    const add = vi.fn(async () => {});

    await processPromptRunJob({ ...PAYLOAD, runId: run.id }, {
      prisma: asPrisma(prisma),
      judgeRunQueue: { add } as unknown as Queue
    });

    expect(add).toHaveBeenCalledTimes(1);
    const [name, payload] = add.mock.calls[0]!;
    expect(name).toBe("judge-run");
    expect((payload as PromptRunJobPayload).prompt.name).toBe("greeter");
  });

  it("keeps the first startedAt when several prompts race", async () => {
    const run = await seedRun(2);
    const judgeRunQueue = { add: vi.fn(async () => {}) } as unknown as Queue;

    await processPromptRunJob({ ...PAYLOAD, runId: run.id }, {
      prisma: asPrisma(prisma),
      judgeRunQueue
    });
    const firstStartedAt = prisma.__store.runs[0]!.startedAt;

    await new Promise((resolve) => setTimeout(resolve, 5));

    await processPromptRunJob({ ...PAYLOAD, runId: run.id }, {
      prisma: asPrisma(prisma),
      judgeRunQueue
    });

    expect(prisma.__store.runs[0]!.startedAt).toEqual(firstStartedAt);
  });
});

describe("processJudgeRunJob", () => {
  it("persists one result row per case and marks the prompt complete", async () => {
    const run = await seedRun(1);

    await processJudgeRunJob({ ...PAYLOAD, runId: run.id }, { prisma: asPrisma(prisma) });

    expect(prisma.__store.results).toHaveLength(1);
    expect(prisma.__store.results[0]?.promptName).toBe("greeter");
    expect(prisma.__store.runs[0]?.completedJobs).toBe(1);
    expect(prisma.__store.runs[0]?.status).toBe("COMPLETED");
  });

  it("records deterministic results with zero tokens", async () => {
    const run = await seedRun(1);

    await processJudgeRunJob(
      {
        ...PAYLOAD,
        runId: run.id,
        testCases: [{ name: "t1", input: "hi", expect: null, assert: { contains: "mock" } }]
      },
      { prisma: asPrisma(prisma) }
    );

    const [result] = prisma.__store.results;
    expect(result?.assertionType).toBe("DETERMINISTIC");
    expect(result?.tokensUsed).toBe(0);
  });

  it("replaces prior results for the same prompt on retry", async () => {
    const run = await seedRun(2);

    await processJudgeRunJob({ ...PAYLOAD, runId: run.id }, { prisma: asPrisma(prisma) });
    await processJudgeRunJob({ ...PAYLOAD, runId: run.id }, { prisma: asPrisma(prisma) });

    // A retried job must not duplicate its rows.
    expect(prisma.__store.results).toHaveLength(1);
  });
});

describe("finalize-run counters", () => {
  it("does not finalise until every job reports in", async () => {
    const run = await seedRun(3);

    await markPromptCompleted(asPrisma(prisma), run.id);
    expect(prisma.__store.runs[0]?.status).toBe("PENDING");

    await markPromptCompleted(asPrisma(prisma), run.id);
    expect(prisma.__store.runs[0]?.status).toBe("PENDING");

    await markPromptCompleted(asPrisma(prisma), run.id);
    expect(prisma.__store.runs[0]?.status).toBe("COMPLETED");
  });

  it("marks the run FAILED when any job failed", async () => {
    const run = await seedRun(2);

    await markPromptFailed(asPrisma(prisma), run.id);
    await markPromptCompleted(asPrisma(prisma), run.id);

    expect(prisma.__store.runs[0]?.status).toBe("FAILED");
    expect(prisma.__store.runs[0]?.failedJobs).toBe(1);
  });

  it("counts a failure toward the completion total so the run can finalise", async () => {
    const run = await seedRun(1);

    await markPromptFailed(asPrisma(prisma), run.id);

    // Without this the counter never reaches expectedJobs and the run hangs.
    expect(prisma.__store.runs[0]?.completedJobs).toBe(1);
    expect(prisma.__store.runs[0]?.status).toBe("FAILED");
  });

  it("scores the run as the failing fraction of results", async () => {
    const run = await seedRun(1);

    await prisma.result.createMany({
      data: [
        { runId: run.id, promptName: "p", testName: "a", pass: true },
        { runId: run.id, promptName: "p", testName: "b", pass: false },
        { runId: run.id, promptName: "p", testName: "c", pass: false },
        { runId: run.id, promptName: "p", testName: "d", pass: true }
      ]
    });

    await markPromptCompleted(asPrisma(prisma), run.id);

    expect(prisma.__store.runs[0]?.score).toBe(0.5);
  });

  it("scores an empty completed run as 0", async () => {
    const run = await seedRun(1);
    await markPromptCompleted(asPrisma(prisma), run.id);
    expect(prisma.__store.runs[0]?.score).toBe(0);
  });

  it("handles all jobs failing", async () => {
    const run = await seedRun(3);

    await markPromptFailed(asPrisma(prisma), run.id);
    await markPromptFailed(asPrisma(prisma), run.id);
    await markPromptFailed(asPrisma(prisma), run.id);

    expect(prisma.__store.runs[0]?.failedJobs).toBe(3);
    expect(prisma.__store.runs[0]?.completedJobs).toBe(3);
    expect(prisma.__store.runs[0]?.status).toBe("FAILED");
  });
});

describe("reconcileStuckRuns", () => {
  it("fails a RUNNING run past its deadline", async () => {
    const run = await seedRun(1);
    await prisma.run.update({
      where: { id: run.id },
      data: { status: "RUNNING", timeoutAt: new Date(Date.now() - 1000) }
    });

    const { timedOutRunIds } = await reconcileStuckRuns(asPrisma(prisma));

    expect(timedOutRunIds).toEqual([run.id]);
    expect(prisma.__store.runs[0]?.status).toBe("FAILED");
  });

  it("fails a PENDING run past its deadline", async () => {
    const run = await seedRun(1);
    await prisma.run.update({
      where: { id: run.id },
      data: { timeoutAt: new Date(Date.now() - 1000) }
    });

    await reconcileStuckRuns(asPrisma(prisma));
    expect(prisma.__store.runs[0]?.status).toBe("FAILED");
  });

  it("leaves a run whose deadline has not passed", async () => {
    const run = await seedRun(1);
    await prisma.run.update({
      where: { id: run.id },
      data: { status: "RUNNING", timeoutAt: new Date(Date.now() + 60_000) }
    });

    const { timedOutRunIds } = await reconcileStuckRuns(asPrisma(prisma));

    expect(timedOutRunIds).toEqual([]);
    expect(prisma.__store.runs[0]?.status).toBe("RUNNING");
  });

  it("ignores runs with no deadline set", async () => {
    await seedRun(1);
    const { timedOutRunIds } = await reconcileStuckRuns(asPrisma(prisma));
    expect(timedOutRunIds).toEqual([]);
  });

  it("never reopens an already terminal run", async () => {
    const run = await seedRun(1);
    await prisma.run.update({
      where: { id: run.id },
      data: { status: "COMPLETED", timeoutAt: new Date(Date.now() - 1000) }
    });

    const { timedOutRunIds } = await reconcileStuckRuns(asPrisma(prisma));

    expect(timedOutRunIds).toEqual([]);
    expect(prisma.__store.runs[0]?.status).toBe("COMPLETED");
  });

  it("is a no-op when nothing is stuck", async () => {
    const { timedOutRunIds } = await reconcileStuckRuns(asPrisma(prisma));
    expect(timedOutRunIds).toEqual([]);
  });
});
