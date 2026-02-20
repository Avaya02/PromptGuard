import Fastify from "fastify";

import { registerPromptRoutes } from "./routes/prompts.js";
import { registerRunRoutes } from "./routes/runs.js";
import type { ApiQueues } from "./lib/queues.js";
import type { PrismaClient } from "@prisma/client";

export interface ApiServerDependencies {
  prisma: PrismaClient;
  queues: ApiQueues;
}

export function buildApiServer(dependencies: ApiServerDependencies) {
  const app = Fastify({
    logger: true
  });

  app.decorate("prisma", dependencies.prisma);
  app.decorate("queues", dependencies.queues);

  app.get("/health", async () => ({ status: "ok" }));

  void registerRunRoutes(app);
  void registerPromptRoutes(app);

  return app;
}
