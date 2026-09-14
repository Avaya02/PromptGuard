import type { FastifyInstance } from "fastify";

import { promptIdParamsSchema } from "../schemas/runs.js";
import { toRunSummary } from "../utils/to-run-summary.js";

export async function registerPromptRoutes(app: FastifyInstance): Promise<void> {
  app.get("/prompts", async () => {
    const prompts = await app.prisma.prompt.findMany({
      orderBy: {
        updatedAt: "desc"
      }
    });

    return prompts.map((prompt) => ({
      id: prompt.id,
      name: prompt.name,
      latestVersion: prompt.latestVersion,
      createdAt: prompt.createdAt.toISOString(),
      updatedAt: prompt.updatedAt.toISOString()
    }));
  });

  app.get("/prompts/:id", async (request, reply) => {
    const { id } = promptIdParamsSchema.parse(request.params);

    const prompt = await app.prisma.prompt.findUnique({
      where: { id },
      include: {
        versions: {
          orderBy: { createdAt: "desc" }
        }
      }
    });

    if (!prompt) {
      reply.status(404);
      return { error: "Prompt not found" };
    }

    return {
      id: prompt.id,
      name: prompt.name,
      latestVersion: prompt.latestVersion,
      createdAt: prompt.createdAt.toISOString(),
      updatedAt: prompt.updatedAt.toISOString(),
      versions: prompt.versions.map((version) => ({
        id: version.id,
        commitSha: version.commitSha,
        content: version.content,
        hash: version.hash,
        createdAt: version.createdAt.toISOString()
      }))
    };
  });

  app.get("/prompts/:id/runs", async (request, reply) => {
    const { id } = promptIdParamsSchema.parse(request.params);

    const prompt = await app.prisma.prompt.findUnique({ where: { id } });
    if (!prompt) {
      reply.status(404);
      return { error: "Prompt not found" };
    }

    const runs = await app.prisma.run.findMany({
      where: {
        results: {
          some: {
            promptName: prompt.name
          }
        }
      },
      orderBy: {
        createdAt: "desc"
      }
    });

    return runs.map(toRunSummary);
  });
}
