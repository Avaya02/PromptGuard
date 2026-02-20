import { Queue, Worker } from "bullmq";

import { QUEUE_NAMES, type PromptRunJobPayload } from "@promptguard/shared-types";

import { loadEnv } from "./env.js";
import { prisma } from "./lib/prisma.js";
import { createRedisConnection } from "./lib/redis.js";
import { markPromptFailed } from "./services/finalize-run.js";
import { processJudgeRunJob } from "./workers/judge-run-worker.js";
import { processPromptRunJob } from "./workers/prompt-run-worker.js";

async function start(): Promise<void> {
  const env = loadEnv();
  const redisConnection = createRedisConnection(env.REDIS_URL);

  const judgeRunQueue = new Queue(QUEUE_NAMES.judgeRun, {
    connection: redisConnection
  });

  const promptWorker = new Worker<PromptRunJobPayload>(
    QUEUE_NAMES.promptRun,
    async (job) => processPromptRunJob(job.data, { prisma, judgeRunQueue }),
    { connection: redisConnection }
  );

  const judgeWorker = new Worker<PromptRunJobPayload>(
    QUEUE_NAMES.judgeRun,
    async (job) => processJudgeRunJob(job.data, { prisma }),
    {
      connection: redisConnection,
      concurrency: 2
    }
  );

  promptWorker.on("failed", (job) => {
    if (!job?.data.runId) {
      return;
    }

    void markPromptFailed(prisma, job.data.runId);
  });

  judgeWorker.on("failed", (job) => {
    if (!job?.data.runId) {
      return;
    }

    void markPromptFailed(prisma, job.data.runId);
  });

  const shutdown = async (): Promise<void> => {
    await promptWorker.close();
    await judgeWorker.close();
    await judgeRunQueue.close();
    await prisma.$disconnect();
  };

  process.on("SIGTERM", () => {
    void shutdown();
  });

  process.on("SIGINT", () => {
    void shutdown();
  });
}

void start();
