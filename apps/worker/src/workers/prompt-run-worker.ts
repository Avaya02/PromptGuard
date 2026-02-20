import type { PrismaClient } from "@prisma/client";
import type { Queue } from "bullmq";

import { type PromptRunJobPayload } from "@promptguard/shared-types";

export interface PromptRunWorkerDependencies {
  prisma: PrismaClient;
  judgeRunQueue: Queue;
}

export async function processPromptRunJob(
  payload: PromptRunJobPayload,
  dependencies: PromptRunWorkerDependencies
): Promise<void> {
  await dependencies.prisma.run.update({
    where: { id: payload.runId },
    data: {
      status: "RUNNING"
    }
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
