import type { PrismaClient } from "@prisma/client";
import type { Queue } from "bullmq";

import { QUEUE_NAMES } from "@diditbreak/shared-types";

import { buildApiServer } from "./app.js";
import { loadEnv } from "./env.js";
import { createQueues } from "./lib/queues.js";
import { prisma } from "./lib/prisma.js";
import { createRedisConnection } from "./lib/redis.js";

declare module "fastify" {
  interface FastifyInstance {
    prisma: PrismaClient;
    queues: {
      promptRunQueue: Queue;
      judgeRunQueue: Queue;
    };
  }
}

async function start(): Promise<void> {
  const env = loadEnv();
  const redisConnection = createRedisConnection(env.REDIS_URL);
  const queues = createQueues(redisConnection);
  const app = buildApiServer({
    prisma,
    queues
  });

  try {
    await app.listen({
      host: env.HOST,
      port: env.PORT
    });

    app.log.info(`API server listening with queues ${QUEUE_NAMES.promptRun}/${QUEUE_NAMES.judgeRun}`);
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }

  const shutdown = async (): Promise<void> => {
    await app.close();
    await queues.promptRunQueue.close();
    await queues.judgeRunQueue.close();
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
