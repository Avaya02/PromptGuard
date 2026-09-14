import type { FastifyInstance } from "fastify";

import type {
  CreateRunResponse,
  PromptRunJobPayload,
  RunViewResponse
} from "@promptguard/shared-types";

import { createRunRequestSchema, listRunsQuerySchema, runIdParamsSchema } from "../schemas/runs.js";
import { buildPromptDiffs } from "../utils/build-prompt-diffs.js";
import { hashContent } from "../utils/hash.js";
import { toRunResultRecords } from "../utils/to-run-results.js";
import { toRunSummary } from "../utils/to-run-summary.js";

export async function registerRunRoutes(app: FastifyInstance): Promise<void> {
  app.post("/runs", async (request, reply) => {
    const payload = createRunRequestSchema.parse(request.body);

    const run = await app.prisma.$transaction(async (tx) => {
      const createdRun = await tx.run.create({
        data: {
          commitSha: payload.commitSha,
          environment: payload.environment,
          status: "PENDING",
          expectedJobs: payload.prompts.length
        }
      });

      for (const promptInput of payload.prompts) {
        const contentHash = hashContent(promptInput.versionB);

        const existingPrompt = await tx.prompt.findUnique({
          where: {
            name: promptInput.name
          }
        });

        if (!existingPrompt) {
          const created = await tx.prompt.create({
            data: {
              name: promptInput.name,
              latestVersion: 1
            }
          });

          await tx.promptVersion.create({
            data: {
              promptId: created.id,
              commitSha: payload.commitSha,
              content: promptInput.versionB,
              hash: contentHash
            }
          });

          continue;
        }

        // Re-running an unchanged prompt (a retry, or another prompt in the same
        // suite changing) must not manufacture a new version. Compare against the
        // newest stored hash and only bump when the content actually differs.
        const latestVersion = await tx.promptVersion.findFirst({
          where: { promptId: existingPrompt.id },
          orderBy: { createdAt: "desc" }
        });

        if (latestVersion?.hash === contentHash) {
          continue;
        }

        const updated = await tx.prompt.update({
          where: { id: existingPrompt.id },
          data: {
            latestVersion: existingPrompt.latestVersion + 1
          }
        });

        await tx.promptVersion.create({
          data: {
            promptId: updated.id,
            commitSha: payload.commitSha,
            content: promptInput.versionB,
            hash: contentHash
          }
        });
      }

      return createdRun;
    });

    for (const prompt of payload.prompts) {
      const jobPayload: PromptRunJobPayload = {
        runId: run.id,
        prompt,
        testCases: payload.testCases,
        threshold: payload.threshold,
        generationModel: payload.generationModel,
        judgeModel: payload.judgeModel
      };

      await app.queues.promptRunQueue.add("prompt-run", jobPayload, {
        attempts: 2,
        backoff: {
          type: "exponential",
          delay: 1000
        },
        removeOnComplete: 100,
        removeOnFail: 100
      });
    }

    const response: CreateRunResponse = {
      run: toRunSummary(run)
    };

    reply.status(201);
    return response;
  });

  app.get("/runs/:id", async (request, reply) => {
    const { id } = runIdParamsSchema.parse(request.params);

    const run = await app.prisma.run.findUnique({ where: { id } });
    if (!run) {
      reply.status(404);
      return { error: "Run not found" };
    }

    return toRunSummary(run);
  });

  app.get("/runs/:id/results", async (request, reply) => {
    const { id } = runIdParamsSchema.parse(request.params);

    const run = await app.prisma.run.findUnique({ where: { id } });
    if (!run) {
      reply.status(404);
      return { error: "Run not found" };
    }

    const results = await app.prisma.result.findMany({
      where: { runId: id },
      orderBy: [{ promptName: "asc" }, { testName: "asc" }]
    });

    return toRunResultRecords(results);
  });

  app.get("/runs/:id/view", async (request, reply) => {
    const { id } = runIdParamsSchema.parse(request.params);

    const run = await app.prisma.run.findUnique({ where: { id } });
    if (!run) {
      reply.status(404);
      return { error: "Run not found" };
    }

    const results = await app.prisma.result.findMany({
      where: { runId: id },
      orderBy: [{ promptName: "asc" }, { testName: "asc" }]
    });

    const response: RunViewResponse = {
      run: toRunSummary(run),
      results: toRunResultRecords(results),
      promptDiffs: await buildPromptDiffs(app.prisma, id, run.commitSha)
    };

    return response;
  });

  app.get("/runs", async (request) => {
    const query = listRunsQuerySchema.parse(request.query);

    const where = {
      ...(query.status !== undefined ? { status: query.status } : {}),
      ...(query.environment !== undefined ? { environment: query.environment } : {})
    };

    // Fetch one extra row to determine whether another page exists without a
    // second count query.
    const rows = await app.prisma.run.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: query.limit + 1,
      ...(query.cursor !== undefined ? { cursor: { id: query.cursor }, skip: 1 } : {})
    });

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;

    return {
      runs: page.map(toRunSummary),
      nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null
    };
  });

  app.delete("/runs/:id", async (request, reply) => {
    const { id } = runIdParamsSchema.parse(request.params);

    const run = await app.prisma.run.findUnique({ where: { id } });
    if (!run) {
      reply.status(404);
      return { error: "Run not found" };
    }

    // Result rows cascade via the schema relation.
    await app.prisma.run.delete({ where: { id } });

    reply.status(204);
    return null;
  });

  app.get("/runs/:id/events", async (request, reply) => {
    const { id } = runIdParamsSchema.parse(request.params);

    const run = await app.prisma.run.findUnique({ where: { id } });
    if (!run) {
      reply.status(404);
      return { error: "Run not found" };
    }

    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      // Disables proxy buffering, which otherwise withholds events until close.
      "x-accel-buffering": "no"
    });

    let closed = false;
    let lastResultCount = -1;
    let lastStatus = "";

    const send = (event: string, data: unknown): void => {
      if (closed) {
        return;
      }

      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const tick = async (): Promise<boolean> => {
      const current = await app.prisma.run.findUnique({ where: { id } });
      if (!current) {
        send("error", { message: "Run disappeared" });
        return true;
      }

      const resultCount = await app.prisma.result.count({ where: { runId: id } });

      // Only emit when something actually changed, so idle runs stay quiet.
      if (current.status !== lastStatus || resultCount !== lastResultCount) {
        lastStatus = current.status;
        lastResultCount = resultCount;

        send("progress", {
          run: toRunSummary(current),
          resultCount
        });
      }

      if (current.status === "COMPLETED" || current.status === "FAILED") {
        const results = await app.prisma.result.findMany({
          where: { runId: id },
          orderBy: [{ promptName: "asc" }, { testName: "asc" }]
        });

        send("complete", {
          run: toRunSummary(current),
          results: toRunResultRecords(results)
        });

        return true;
      }

      return false;
    };

    const interval = setInterval(() => {
      void tick()
        .then((done) => {
          if (done) {
            cleanup();
          }
        })
        .catch(() => {
          cleanup();
        });
    }, 1000);

    // Comment frames keep intermediaries from timing the connection out.
    const heartbeat = setInterval(() => {
      if (!closed) {
        reply.raw.write(": keepalive\n\n");
      }
    }, 15000);

    function cleanup(): void {
      if (closed) {
        return;
      }

      closed = true;
      clearInterval(interval);
      clearInterval(heartbeat);
      reply.raw.end();
    }

    request.raw.on("close", cleanup);

    void tick()
      .then((done) => {
        if (done) {
          cleanup();
        }
      })
      .catch(() => {
        cleanup();
      });

    return reply;
  });
}
