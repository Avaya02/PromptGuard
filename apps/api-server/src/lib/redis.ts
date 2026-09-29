import type { ConnectionOptions } from "bullmq";

export function createRedisConnection(redisUrl: string): ConnectionOptions {
  const parsed = new URL(redisUrl);
  const port = parsed.port ? Number(parsed.port) : 6379;
  const dbText = parsed.pathname.replace("/", "");
  const db = dbText ? Number(dbText) : undefined;

  return {
    host: parsed.hostname,
    port,
    maxRetriesPerRequest: null,
    ...(parsed.username ? { username: parsed.username } : {}),
    ...(parsed.password ? { password: parsed.password } : {}),
    ...(typeof db === "number" && Number.isFinite(db) ? { db } : {})
  };
}
