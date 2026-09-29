import { Queue, Worker } from "bullmq";

import { QUEUE_NAMES, type PromptRunJobPayload } from "@promptguard/shared-types";

import { loadEnv } from "./env.js";
import { prisma } from "./lib/prisma.js";
import { createRedisConnection } from "./lib/redis.js";
import { markPromptFailed } from "./services/finalize-run.js";
import { startRunReconciler } from "./services/reconcile-runs.js";
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

  // A stalled job is one whose worker died without releasing its lock. BullMQ
  // reports the job id only, so the run id has to be read back from the queue.
  // Without this the run's counter never reaches expectedJobs and it hangs.
  const handleStalled = async (queue: Queue, jobId: string): Promise<void> => {
    try {
      const job = await queue.getJob(jobId);
      const runId = job?.data?.runId;

      if (typeof runId === "string" && runId.length > 0) {
        await markPromptFailed(prisma, runId);
      }
    } catch (error) {
      console.error(`Failed to reconcile stalled job ${jobId}:`, error);
    }
  };

  const promptRunQueue = new Queue(QUEUE_NAMES.promptRun, { connection: redisConnection });

  promptWorker.on("stalled", (jobId) => {
    void handleStalled(promptRunQueue, jobId);
  });

  judgeWorker.on("stalled", (jobId) => {
    void handleStalled(judgeRunQueue, jobId);
  });

  const stopReconciler = startRunReconciler(prisma, {
    onError: (error) => {
      console.error("Run reconciliation failed:", error);
    }
  });

  const shutdown = async (): Promise<void> => {
    stopReconciler();
    await promptWorker.close();
    await judgeWorker.close();
    await judgeRunQueue.close();
    await promptRunQueue.close();
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
