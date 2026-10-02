import { runEvaluation } from "@diditbreak/evaluator";
import { createProvider } from "@diditbreak/llm-provider";
import type { FastifyInstance } from "fastify";

import { evaluateRequestSchema } from "../schemas/runs.js";

/**
 * On-demand single-case evaluation for the Playground.
 *
 * Runs inline rather than through the queue: the caller is waiting on the
 * response, and a one-case run does not justify a round trip through Redis.
 * Model config is optional and defaults to MockProvider, so the endpoint works
 * with no API keys configured.
 */
export async function registerEvaluateRoutes(app: FastifyInstance): Promise<void> {
  app.post("/evaluate", async (request, reply) => {
    const payload = evaluateRequestSchema.parse(request.body);

    if (payload.expect == null && payload.assert === undefined) {
      reply.status(400);
      return {
        error: "Provide `expect` (judge rubric) or `assert` (deterministic checks), or both."
      };
    }

    let generationProvider;
    let judgeProvider;
    try {
      generationProvider = createProvider(payload.generationModel);
      judgeProvider = createProvider(payload.judgeModel);
    } catch (error) {
      // Missing API keys surface here, and are the caller's problem to fix.
      reply.status(400);
      return { error: error instanceof Error ? error.message : "Invalid provider configuration." };
    }

    const evaluation = await runEvaluation({
      promptName: "playground",
      versionB: payload.prompt,
      threshold: 0,
      concurrency: 1,
      generationProvider,
      judgeProvider,
      testCases: [
        {
          name: "playground",
          input: payload.input,
          expect: payload.expect ?? null,
          ...(payload.assert !== undefined ? { assert: payload.assert } : {})
        }
      ]
    });

    const result = evaluation.results[0];
    if (!result) {
      reply.status(500);
      return { error: "Evaluation produced no result." };
    }

    return { result };
  });
}
