import type { PrismaClient } from "@prisma/client";

import { runEvaluation } from "@promptguard/evaluator";
import type { PromptRunJobPayload } from "@promptguard/shared-types";

import { createProvider } from "../providers/create-provider.js";
import { markPromptCompleted } from "../services/finalize-run.js";

export interface JudgeRunWorkerDependencies {
  prisma: PrismaClient;
}

export async function processJudgeRunJob(
  payload: PromptRunJobPayload,
  dependencies: JudgeRunWorkerDependencies
): Promise<void> {
  const generationProvider = createProvider(payload.generationModel);
  const judgeProvider = createProvider(payload.judgeModel);

  const result = await runEvaluation({
    promptName: payload.prompt.name,
    versionB: payload.prompt.versionB,
    threshold: payload.threshold,
    testCases: payload.testCases,
    generationProvider,
    judgeProvider,
    ...(payload.prompt.versionA !== undefined ? { versionA: payload.prompt.versionA } : {})
  });

  await dependencies.prisma.$transaction(async (tx) => {
    await tx.result.deleteMany({
      where: {
        runId: payload.runId,
        promptName: payload.prompt.name
      }
    });

    await tx.result.createMany({
      data: result.results.map((caseResult) => ({
        runId: payload.runId,
        promptName: payload.prompt.name,
        testName: caseResult.testName,
        pass: caseResult.pass,
        driftScore: caseResult.driftScore,
        reasoning: caseResult.reason,
        latencyMs: caseResult.latencyMs,
        tokensUsed: caseResult.tokensUsed
      }))
    });
  });

  await markPromptCompleted(dependencies.prisma, payload.runId);
}
