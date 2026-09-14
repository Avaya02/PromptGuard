import { describe, expect, it } from "vitest";

import { loadEnv } from "../src/env.js";
import { createRedisConnection } from "../src/lib/redis.js";

describe("loadEnv", () => {
  it("defaults REDIS_URL", () => {
    expect(loadEnv({ DATABASE_URL: "postgresql://localhost:5433/db" }).REDIS_URL).toBe(
      "redis://127.0.0.1:6379"
    );
  });

  it("requires DATABASE_URL", () => {
    expect(() => loadEnv({})).toThrow();
  });

  it("rejects a malformed REDIS_URL", () => {
    expect(() => loadEnv({ DATABASE_URL: "x", REDIS_URL: "nope" })).toThrow();
  });
});

describe("createRedisConnection", () => {
  it("parses host and port", () => {
    expect(createRedisConnection("redis://localhost:6380")).toMatchObject({
      host: "localhost",
      port: 6380
    });
  });

  it("defaults the port to 6379", () => {
    expect(createRedisConnection("redis://cache")).toMatchObject({ port: 6379 });
  });

  it("extracts credentials when present", () => {
    expect(createRedisConnection("redis://user:secret@host:6379")).toMatchObject({
      username: "user",
      password: "secret"
    });
  });

  it("omits credentials when absent", () => {
    const connection = createRedisConnection("redis://host:6379");
    expect(connection).not.toHaveProperty("username");
    expect(connection).not.toHaveProperty("password");
  });

  it("parses a database index from the path", () => {
    expect(createRedisConnection("redis://host:6379/3")).toMatchObject({ db: 3 });
  });

  it("omits db when the path is empty", () => {
    expect(createRedisConnection("redis://host:6379")).not.toHaveProperty("db");
  });

  it("disables the per-request retry cap for BullMQ", () => {
    // BullMQ requires maxRetriesPerRequest: null on its blocking connections.
    expect(createRedisConnection("redis://host")).toMatchObject({ maxRetriesPerRequest: null });
  });
});
