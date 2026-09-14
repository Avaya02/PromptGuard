import type { FastifyInstance } from "fastify";

type Connectivity = "connected" | "disconnected";

interface HealthResponse {
  status: "ok" | "degraded";
  db: Connectivity;
  redis: Connectivity;
}

async function checkDb(app: FastifyInstance): Promise<Connectivity> {
  try {
    await app.prisma.$queryRaw`SELECT 1`;
    return "connected";
  } catch {
    return "disconnected";
  }
}

async function checkRedis(app: FastifyInstance): Promise<Connectivity> {
  try {
    // BullMQ exposes the underlying ioredis client as a promise.
    const client = await app.queues.promptRunQueue.client;
    const pong = await client.ping();
    return pong === "PONG" ? "connected" : "disconnected";
  } catch {
    return "disconnected";
  }
}

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async (_request, reply) => {
    const [db, redis] = await Promise.all([checkDb(app), checkRedis(app)]);
    const healthy = db === "connected" && redis === "connected";

    const response: HealthResponse = {
      status: healthy ? "ok" : "degraded",
      db,
      redis
    };

    // 503 lets orchestrators and uptime checks act on this without parsing JSON.
    reply.status(healthy ? 200 : 503);
    return response;
  });
}
