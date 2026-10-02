import type { PrismaClient } from "@prisma/client";
import type { Queue } from "bullmq";

import { type PromptRunJobPayload } from "@diditbreak/shared-types";

import { RUN_TIMEOUT_MS } from "../services/reconcile-runs.js";

export interface PromptRunWorkerDependencies {
  prisma: PrismaClient;
  judgeRunQueue: Queue;
}

export async function processPromptRunJob(
  payload: PromptRunJobPayload,
  dependencies: PromptRunWorkerDependencies
): Promise<void> {
  const now = new Date();

  await dependencies.prisma.run.update({
    where: { id: payload.runId },
    data: {
      status: "RUNNING",
      timeoutAt: new Date(now.getTime() + RUN_TIMEOUT_MS)
    }
  });

  // A run fans out to one job per prompt, so several jobs race through here.
  // Guarding on startedAt: null keeps the first arrival's timestamp.
  await dependencies.prisma.run.updateMany({
    where: { id: payload.runId, startedAt: null },
    data: { startedAt: now }
  });

  await dependencies.judgeRunQueue.add("judge-run", payload, {
    attempts: 2,
    backoff: {
      type: "exponential",
      delay: 1000
    },
    removeOnComplete: 100,
    removeOnFail: 100
  });
}
