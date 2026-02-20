import type { FastifyInstance } from "fastify";

import type {
  CreateRunResponse,
  PromptRunJobPayload,
  RunResultRecord
} from "@promptguard/shared-types";

import { createRunRequestSchema, runIdParamsSchema } from "../schemas/runs.js";
import { hashContent } from "../utils/hash.js";
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
        const existingPrompt = await tx.prompt.findUnique({
          where: {
            name: promptInput.name
          }
        });

        const prompt = existingPrompt
          ? await tx.prompt.update({
              where: { id: existingPrompt.id },
              data: {
                latestVersion: existingPrompt.latestVersion + 1
              }
            })
          : await tx.prompt.create({
              data: {
                name: promptInput.name,
                latestVersion: 1
              }
            });

        await tx.promptVersion.create({
          data: {
            promptId: prompt.id,
            commitSha: payload.commitSha,
            content: promptInput.versionB,
            hash: hashContent(promptInput.versionB)
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

    const response: RunResultRecord[] = results.map((result) => ({
      id: result.id,
      runId: result.runId,
      promptName: result.promptName,
      testName: result.testName,
      pass: result.pass,
      driftScore: result.driftScore,
      reasoning: result.reasoning,
      latencyMs: result.latencyMs,
      tokensUsed: result.tokensUsed,
      createdAt: result.createdAt.toISOString()
    }));

    return response;
  });
}
