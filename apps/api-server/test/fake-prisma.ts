import { randomUUID } from "node:crypto";

/**
 * Minimal in-memory stand-in for the subset of PrismaClient the routes use.
 *
 * Keeps the API integration suite runnable with no Docker and no database,
 * which is what lets CI exercise the routes at zero cost. It is deliberately
 * not a general Prisma emulator — it implements only the queries these routes
 * actually issue, and throws loudly on anything else.
 */

export interface FakeRun {
  id: string;
  commitSha: string;
  environment: "LOCAL" | "CI" | "PROD";
  score: number | null;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
  expectedJobs: number;
  completedJobs: number;
  failedJobs: number;
  startedAt: Date | null;
  timeoutAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface FakePrompt {
  id: string;
  name: string;
  latestVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface FakePromptVersion {
  id: string;
  promptId: string;
  commitSha: string;
  content: string;
  hash: string;
  createdAt: Date;
}

export interface FakeResult {
  id: string;
  runId: string;
  promptName: string;
  testName: string;
  pass: boolean;
  driftScore: number;
  reasoning: string;
  latencyMs: number;
  tokensUsed: number;
  assertionType: "DETERMINISTIC" | "SEMANTIC";
  estimatedCostUsd: number | null;
  createdAt: Date;
}

interface Store {
  runs: FakeRun[];
  prompts: FakePrompt[];
  promptVersions: FakePromptVersion[];
  results: FakeResult[];
}

function matches(row: Record<string, unknown>, where: Record<string, unknown> | undefined): boolean {
  if (!where) {
    return true;
  }

  return Object.entries(where).every(([key, condition]) => {
    const value = row[key];

    if (condition !== null && typeof condition === "object" && !(condition instanceof Date)) {
      const clause = condition as Record<string, unknown>;

      if ("in" in clause) {
        return (clause.in as unknown[]).includes(value);
      }
      if ("lt" in clause) {
        return value !== null && (value as number) < (clause.lt as number);
      }
      if ("not" in clause) {
        return clause.not === null ? value !== null : value !== clause.not;
      }
      if ("some" in clause) {
        return true;
      }
    }

    return value === condition;
  });
}

function sortRows<T extends Record<string, unknown>>(
  rows: T[],
  orderBy: unknown
): T[] {
  const clauses = Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : [];
  if (clauses.length === 0) {
    return rows;
  }

  return [...rows].sort((a, b) => {
    for (const clause of clauses as Array<Record<string, "asc" | "desc">>) {
      const [field, direction] = Object.entries(clause)[0]!;
      const av = a[field];
      const bv = b[field];
      if (av === bv) {
        continue;
      }

      const less = (av as number) < (bv as number);
      return direction === "desc" ? (less ? 1 : -1) : less ? -1 : 1;
    }
    return 0;
  });
}

export function createFakePrisma(seed: Partial<Store> = {}) {
  const store: Store = {
    runs: seed.runs ?? [],
    prompts: seed.prompts ?? [],
    promptVersions: seed.promptVersions ?? [],
    results: seed.results ?? []
  };

  const now = (): Date => new Date();

  const client = {
    __store: store,

    async $queryRaw(): Promise<unknown> {
      return [{ "?column?": 1 }];
    },

    async $transaction<T>(fn: (tx: typeof client) => Promise<T>): Promise<T> {
      // No rollback semantics; the routes under test do not depend on them.
      return fn(client);
    },

    run: {
      async create({ data }: { data: Partial<FakeRun> }): Promise<FakeRun> {
        const row: FakeRun = {
          id: randomUUID(),
          commitSha: data.commitSha ?? "",
          environment: data.environment ?? "LOCAL",
          score: data.score ?? null,
          status: data.status ?? "PENDING",
          expectedJobs: data.expectedJobs ?? 0,
          completedJobs: 0,
          failedJobs: 0,
          startedAt: null,
          timeoutAt: null,
          createdAt: now(),
          updatedAt: now()
        };
        store.runs.push(row);
        return row;
      },

      async findUnique({ where }: { where: { id: string } }): Promise<FakeRun | null> {
        return store.runs.find((run) => run.id === where.id) ?? null;
      },

      async findMany(args: Record<string, unknown> = {}): Promise<FakeRun[]> {
        let rows = store.runs.filter((run) =>
          matches(run as unknown as Record<string, unknown>, args.where as Record<string, unknown>)
        );
        rows = sortRows(rows as unknown as Array<Record<string, unknown>>, args.orderBy) as unknown as FakeRun[];

        if (args.cursor) {
          const cursorId = (args.cursor as { id: string }).id;
          const index = rows.findIndex((run) => run.id === cursorId);
          if (index >= 0) {
            rows = rows.slice(index + ((args.skip as number) ?? 0));
          }
        }

        if (typeof args.take === "number") {
          rows = rows.slice(0, args.take);
        }

        return rows;
      },

      async update({
        where,
        data
      }: {
        where: { id: string };
        data: Record<string, unknown>;
      }): Promise<FakeRun> {
        const row = store.runs.find((run) => run.id === where.id);
        if (!row) {
          throw new Error("Run not found");
        }

        for (const [key, value] of Object.entries(data)) {
          if (value && typeof value === "object" && "increment" in value) {
            (row as unknown as Record<string, number>)[key] =
              ((row as unknown as Record<string, number>)[key] ?? 0) +
              ((value as { increment: number }).increment);
          } else {
            (row as unknown as Record<string, unknown>)[key] = value;
          }
        }

        row.updatedAt = now();
        return row;
      },

      async updateMany({
        where,
        data
      }: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }): Promise<{ count: number }> {
        const rows = store.runs.filter((run) =>
          matches(run as unknown as Record<string, unknown>, where)
        );

        for (const row of rows) {
          Object.assign(row, data);
          row.updatedAt = now();
        }

        return { count: rows.length };
      },

      async delete({ where }: { where: { id: string } }): Promise<FakeRun> {
        const index = store.runs.findIndex((run) => run.id === where.id);
        if (index === -1) {
          throw new Error("Run not found");
        }

        const [removed] = store.runs.splice(index, 1);
        // Mirrors the schema's onDelete: Cascade.
        store.results = store.results.filter((result) => result.runId !== where.id);
        return removed!;
      }
    },

    prompt: {
      async findUnique(args: {
        where: { id?: string; name?: string };
        include?: Record<string, unknown>;
        select?: Record<string, unknown>;
      }): Promise<Record<string, unknown> | null> {
        const row = store.prompts.find(
          (prompt) =>
            (args.where.id !== undefined && prompt.id === args.where.id) ||
            (args.where.name !== undefined && prompt.name === args.where.name)
        );

        if (!row) {
          return null;
        }

        if (args.include?.versions) {
          const versions = sortRows(
            store.promptVersions.filter(
              (v) => v.promptId === row.id
            ) as unknown as Array<Record<string, unknown>>,
            (args.include.versions as { orderBy?: unknown }).orderBy
          );
          return { ...row, versions };
        }

        return row as unknown as Record<string, unknown>;
      },

      async findMany(args: Record<string, unknown> = {}): Promise<FakePrompt[]> {
        return sortRows(
          store.prompts as unknown as Array<Record<string, unknown>>,
          args.orderBy
        ) as unknown as FakePrompt[];
      },

      async create({ data }: { data: Partial<FakePrompt> }): Promise<FakePrompt> {
        const row: FakePrompt = {
          id: randomUUID(),
          name: data.name ?? "",
          latestVersion: data.latestVersion ?? 1,
          createdAt: now(),
          updatedAt: now()
        };
        store.prompts.push(row);
        return row;
      },

      async update({
        where,
        data
      }: {
        where: { id: string };
        data: Partial<FakePrompt>;
      }): Promise<FakePrompt> {
        const row = store.prompts.find((prompt) => prompt.id === where.id);
        if (!row) {
          throw new Error("Prompt not found");
        }
        Object.assign(row, data, { updatedAt: now() });
        return row;
      }
    },

    promptVersion: {
      async create({ data }: { data: Partial<FakePromptVersion> }): Promise<FakePromptVersion> {
        const row: FakePromptVersion = {
          id: randomUUID(),
          promptId: data.promptId ?? "",
          commitSha: data.commitSha ?? "",
          content: data.content ?? "",
          hash: data.hash ?? "",
          // Nudge createdAt forward so ordering is stable within a fast test.
          createdAt: new Date(Date.now() + store.promptVersions.length)
        };
        store.promptVersions.push(row);
        return row;
      },

      async findFirst(args: Record<string, unknown> = {}): Promise<FakePromptVersion | null> {
        const rows = sortRows(
          store.promptVersions.filter((v) =>
            matches(v as unknown as Record<string, unknown>, args.where as Record<string, unknown>)
          ) as unknown as Array<Record<string, unknown>>,
          args.orderBy
        ) as unknown as FakePromptVersion[];

        return rows[0] ?? null;
      },

      async findMany(args: Record<string, unknown> = {}): Promise<FakePromptVersion[]> {
        let rows = sortRows(
          store.promptVersions.filter((v) =>
            matches(v as unknown as Record<string, unknown>, args.where as Record<string, unknown>)
          ) as unknown as Array<Record<string, unknown>>,
          args.orderBy
        ) as unknown as FakePromptVersion[];

        if (typeof args.take === "number") {
          rows = rows.slice(0, args.take);
        }

        return rows;
      }
    },

    result: {
      async findMany(args: Record<string, unknown> = {}): Promise<FakeResult[]> {
        const rows = store.results.filter((r) =>
          matches(r as unknown as Record<string, unknown>, args.where as Record<string, unknown>)
        );

        if ((args.distinct as string[] | undefined)?.includes("promptName")) {
          const seen = new Set<string>();
          const distinct = rows.filter((row) => {
            if (seen.has(row.promptName)) {
              return false;
            }
            seen.add(row.promptName);
            return true;
          });
          return sortRows(
            distinct as unknown as Array<Record<string, unknown>>,
            args.orderBy
          ) as unknown as FakeResult[];
        }

        return sortRows(
          rows as unknown as Array<Record<string, unknown>>,
          args.orderBy
        ) as unknown as FakeResult[];
      },

      async count(args: Record<string, unknown> = {}): Promise<number> {
        return store.results.filter((r) =>
          matches(r as unknown as Record<string, unknown>, args.where as Record<string, unknown>)
        ).length;
      },

      async createMany({ data }: { data: Array<Partial<FakeResult>> }): Promise<{ count: number }> {
        for (const item of data) {
          store.results.push({
            id: randomUUID(),
            runId: item.runId ?? "",
            promptName: item.promptName ?? "",
            testName: item.testName ?? "",
            pass: item.pass ?? false,
            driftScore: item.driftScore ?? 0,
            reasoning: item.reasoning ?? "",
            latencyMs: item.latencyMs ?? 0,
            tokensUsed: item.tokensUsed ?? 0,
            assertionType: item.assertionType ?? "SEMANTIC",
            estimatedCostUsd: item.estimatedCostUsd ?? null,
            createdAt: now()
          });
        }
        return { count: data.length };
      },

      async deleteMany({ where }: { where: Record<string, unknown> }): Promise<{ count: number }> {
        const before = store.results.length;
        store.results = store.results.filter(
          (r) => !matches(r as unknown as Record<string, unknown>, where)
        );
        return { count: before - store.results.length };
      }
    }
  };

  return client;
}

export type FakePrisma = ReturnType<typeof createFakePrisma>;

/** Queue double recording enqueued jobs, with a Redis client stub for /health. */
export function createFakeQueues(options: { redisOk?: boolean } = {}) {
  const makeQueue = () => {
    const added: Array<{ name: string; payload: unknown }> = [];

    return {
      added,
      async add(name: string, payload: unknown): Promise<void> {
        added.push({ name, payload });
      },
      // Declared as a getter to match BullMQ's `queue.client` promise. It is
      // built lazily inside an async function so merely reading the property
      // never leaves an unhandled rejection behind.
      get client(): Promise<{ ping: () => Promise<string> }> {
        return (async () => {
          if (options.redisOk === false) {
            throw new Error("redis down");
          }
          return { ping: async () => "PONG" };
        })();
      }
    };
  };

  return {
    promptRunQueue: makeQueue(),
    judgeRunQueue: makeQueue()
  };
}
