import type { PrismaClient } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApiServer } from "../src/app.js";
import type { ApiQueues } from "../src/lib/queues.js";
import { createFakePrisma, createFakeQueues, type FakePrisma } from "./fake-prisma.js";

let prisma: FakePrisma;
let app: ReturnType<typeof buildApiServer>;

beforeEach(() => {
  prisma = createFakePrisma();
  app = buildApiServer({
    prisma: prisma as unknown as PrismaClient,
    queues: createFakeQueues() as unknown as ApiQueues,
    logger: false
  });
});

afterEach(async () => {
  await app.close();
});

async function seedRun(status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED") {
  const run = await prisma.run.create({
    data: { commitSha: "abc", environment: "CI", status, expectedJobs: 1 }
  });
  return run;
}

describe("GET /runs/:id/events", () => {
  it("404s for an unknown run", async () => {
    const response = await app.inject({ method: "GET", url: "/runs/nope/events" });
    expect(response.statusCode).toBe(404);
  });

  it("streams a terminal run's results and closes immediately", async () => {
    const run = await seedRun("COMPLETED");
    await prisma.result.createMany({
      data: [
        {
          runId: run.id,
          promptName: "greeter",
          testName: "t1",
          pass: true,
          driftScore: 0,
          reasoning: "ok",
          latencyMs: 5,
          tokensUsed: 0,
          assertionType: "DETERMINISTIC"
        }
      ]
    });

    const response = await app.inject({ method: "GET", url: `/runs/${run.id}/events` });

    expect(response.headers["content-type"]).toContain("text/event-stream");
    expect(response.headers["cache-control"]).toContain("no-cache");

    const body = response.body;
    expect(body).toContain("event: progress");
    expect(body).toContain("event: complete");
    // The terminal frame carries the full result set so the client needs no
    // follow-up request.
    expect(body).toContain("greeter");
  });

  it("emits a complete event for a failed run", async () => {
    const run = await seedRun("FAILED");
    const response = await app.inject({ method: "GET", url: `/runs/${run.id}/events` });

    expect(response.body).toContain("event: complete");
    expect(response.body).toContain('"status":"FAILED"');
  });

  it("frames events as valid SSE with parseable JSON", async () => {
    const run = await seedRun("COMPLETED");
    const response = await app.inject({ method: "GET", url: `/runs/${run.id}/events` });

    const dataLines = response.body
      .split("\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => line.slice("data: ".length));

    expect(dataLines.length).toBeGreaterThan(0);
    for (const line of dataLines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  it("disables proxy buffering so events are not withheld", async () => {
    const run = await seedRun("COMPLETED");
    const response = await app.inject({ method: "GET", url: `/runs/${run.id}/events` });
    expect(response.headers["x-accel-buffering"]).toBe("no");
  });
});

describe("GET /runs/:id/view", () => {
  it("404s for an unknown run", async () => {
    const response = await app.inject({ method: "GET", url: "/runs/nope/view" });
    expect(response.statusCode).toBe(404);
  });

  it("returns the run, its results, and prompt diffs", async () => {
    const run = await prisma.run.create({
      data: { commitSha: "sha-2", environment: "CI", status: "COMPLETED", expectedJobs: 1 }
    });

    const prompt = await prisma.prompt.create({ data: { name: "greeter", latestVersion: 2 } });
    await prisma.promptVersion.create({
      data: { promptId: prompt.id, commitSha: "sha-1", content: "old text", hash: "h1" }
    });
    await prisma.promptVersion.create({
      data: { promptId: prompt.id, commitSha: "sha-2", content: "new text", hash: "h2" }
    });

    await prisma.result.createMany({
      data: [
        {
          runId: run.id,
          promptName: "greeter",
          testName: "t1",
          pass: false,
          driftScore: 1,
          reasoning: "regressed",
          latencyMs: 9,
          tokensUsed: 3
        }
      ]
    });

    const response = await app.inject({ method: "GET", url: `/runs/${run.id}/view` });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.run.id).toBe(run.id);
    expect(body.results).toHaveLength(1);

    const [diff] = body.promptDiffs;
    expect(diff.promptName).toBe("greeter");
    expect(diff.after).toBe("new text");
    expect(diff.before).toBe("old text");
  });

  it("reports a null baseline for a prompt's first version", async () => {
    const run = await prisma.run.create({
      data: { commitSha: "sha-1", environment: "CI", status: "COMPLETED", expectedJobs: 1 }
    });

    const prompt = await prisma.prompt.create({ data: { name: "greeter", latestVersion: 1 } });
    await prisma.promptVersion.create({
      data: { promptId: prompt.id, commitSha: "sha-1", content: "only text", hash: "h1" }
    });
    await prisma.result.createMany({
      data: [{ runId: run.id, promptName: "greeter", testName: "t1", pass: true }]
    });

    const [diff] = (await app.inject({ method: "GET", url: `/runs/${run.id}/view` })).json()
      .promptDiffs;

    expect(diff.before).toBeNull();
    expect(diff.after).toBe("only text");
  });

  it("degrades gracefully when a result names an unregistered prompt", async () => {
    const run = await prisma.run.create({
      data: { commitSha: "sha-1", environment: "CI", status: "COMPLETED", expectedJobs: 1 }
    });
    await prisma.result.createMany({
      data: [{ runId: run.id, promptName: "ghost", testName: "t1", pass: true }]
    });

    const [diff] = (await app.inject({ method: "GET", url: `/runs/${run.id}/view` })).json()
      .promptDiffs;

    expect(diff).toEqual({ promptName: "ghost", before: null, after: "" });
  });
});

describe("GET /prompts/:id/runs", () => {
  it("404s for an unknown prompt", async () => {
    const response = await app.inject({ method: "GET", url: "/prompts/nope/runs" });
    expect(response.statusCode).toBe(404);
  });

  it("returns the runs touching that prompt", async () => {
    const prompt = await prisma.prompt.create({ data: { name: "greeter", latestVersion: 1 } });
    const run = await prisma.run.create({
      data: { commitSha: "abc", environment: "CI", status: "COMPLETED", expectedJobs: 1 }
    });
    await prisma.result.createMany({
      data: [{ runId: run.id, promptName: "greeter", testName: "t1", pass: true }]
    });

    const response = await app.inject({ method: "GET", url: `/prompts/${prompt.id}/runs` });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveLength(1);
  });
});
