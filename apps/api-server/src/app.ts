import Fastify from "fastify";

import { registerEvaluateRoutes } from "./routes/evaluate.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerPromptRoutes } from "./routes/prompts.js";
import { registerRunRoutes } from "./routes/runs.js";
import type { ApiQueues } from "./lib/queues.js";
import type { PrismaClient } from "@prisma/client";

export interface ApiServerDependencies {
  prisma: PrismaClient;
  queues: ApiQueues;
  /** Fastify logger config; tests pass false to keep output readable. */
  logger?: boolean;
}

export function buildApiServer(dependencies: ApiServerDependencies) {
  const app = Fastify({
    logger: dependencies.logger ?? true
  });

  app.decorate("prisma", dependencies.prisma);
  app.decorate("queues", dependencies.queues);

  void registerHealthRoutes(app);
  void registerRunRoutes(app);
  void registerPromptRoutes(app);
  void registerEvaluateRoutes(app);

  return app;
}
