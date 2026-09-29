/**
 * Seeds a demo-ready database: four realistic prompts, their version history,
 * and a spread of historical runs with plausible metrics.
 *
 * Every value is hardcoded — no LLM is called and no API key is needed, so
 * `pnpm seed` produces a fully populated dashboard offline.
 */
import { createHash } from "node:crypto";

import { PrismaClient, type AssertionType, type RunStatus } from "@prisma/client";

const prisma = new PrismaClient();

interface PromptSeed {
  name: string;
  versions: string[];
  cases: Array<{ testName: string; deterministic: boolean }>;
}

const PROMPTS: PromptSeed[] = [
  {
    name: "customer-support-agent",
    versions: [
      "You are a support agent. Be helpful and concise.",
      "You are a support agent. Be helpful, concise, and always acknowledge the customer's frustration before offering a solution.",
      "You are a support agent for an e-commerce company. Acknowledge frustration, offer a concrete remedy (refund or replacement), and never blame the customer."
    ],
    cases: [
      { testName: "damaged-order", deterministic: false },
      { testName: "refund-request", deterministic: false },
      { testName: "no-apology-loop", deterministic: true },
      { testName: "response-under-2s", deterministic: true }
    ]
  },
  {
    name: "code-review-assistant",
    versions: [
      "Review the following code and list issues.",
      "Review the following code. List correctness issues first, then style. Cite line numbers.",
      "Review the following code. List correctness issues first, then style. Cite line numbers. Do not suggest rewrites unless a bug is present."
    ],
    cases: [
      { testName: "flags-null-deref", deterministic: false },
      { testName: "cites-line-numbers", deterministic: true },
      { testName: "no-false-positives", deterministic: false },
      { testName: "ignores-formatting", deterministic: true }
    ]
  },
  {
    name: "sql-query-generator",
    versions: [
      "Convert the request into a SQL query.",
      "Convert the request into a single PostgreSQL query. Return only SQL, no prose."
    ],
    cases: [
      { testName: "valid-sql-syntax", deterministic: true },
      { testName: "no-prose-wrapper", deterministic: true },
      { testName: "correct-join", deterministic: false },
      { testName: "rejects-drop-table", deterministic: true }
    ]
  },
  {
    name: "content-moderation-filter",
    versions: [
      "Classify the content as safe or unsafe.",
      'Classify the content. Return JSON: {"verdict":"safe"|"unsafe","category":string}.',
      'Classify the content. Return JSON: {"verdict":"safe"|"unsafe","category":string,"confidence":number}.'
    ],
    cases: [
      { testName: "json-schema-conformance", deterministic: true },
      { testName: "flags-harassment", deterministic: false },
      { testName: "allows-criticism", deterministic: false },
      { testName: "latency-budget", deterministic: true }
    ]
  }
];

const PASS_REASONS = [
  "Response satisfies the rubric; tone and structure match the baseline.",
  "Output is materially equivalent to the previous version. No regression detected.",
  "All required elements present. Judge found no degradation in quality.",
  "Response is more specific than the baseline while preserving intent."
];

const FAIL_REASONS = [
  "Response omits the remedy step required by the rubric.",
  "Tone shifted from empathetic to transactional compared with the baseline.",
  "Output wrapped the JSON in prose, breaking downstream parsing.",
  "Judge found the answer factually weaker than the previous version.",
  "Response introduced a hedging preamble that the rubric forbids."
];

const DETERMINISTIC_FAILS = [
  "json_schema: /confidence must be number",
  "not_contains: expected output not to contain \"I'm sorry\"",
  "regex: output did not match /^SELECT/i",
  "max_latency_ms: took 3480ms, budget 2000ms",
  "contains: expected output to contain \"line \""
];

/** Deterministic PRNG so repeated seeds produce an identical database. */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = createRandom(20260914);

function pick<T>(items: T[]): T {
  return items[Math.floor(random() * items.length)]!;
}

function hash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function fakeSha(index: number): string {
  return createHash("sha1").update(`commit-${index}`).digest("hex");
}

async function main(): Promise<void> {
  console.log("Clearing existing data...");
  await prisma.result.deleteMany();
  await prisma.run.deleteMany();
  await prisma.promptVersion.deleteMany();
  await prisma.prompt.deleteMany();

  console.log("Seeding prompts and version history...");
  for (const [promptIndex, seed] of PROMPTS.entries()) {
    const prompt = await prisma.prompt.create({
      data: { name: seed.name, latestVersion: seed.versions.length }
    });

    for (const [versionIndex, content] of seed.versions.entries()) {
      await prisma.promptVersion.create({
        data: {
          promptId: prompt.id,
          commitSha: fakeSha(promptIndex * 10 + versionIndex),
          content,
          hash: hash(content),
          // Space versions out so the diff view has a believable timeline.
          createdAt: new Date(Date.now() - (seed.versions.length - versionIndex) * 86_400_000 * 3)
        }
      });
    }
  }

  console.log("Seeding historical runs...");
  let runCounter = 0;
  let totalResults = 0;

  for (const [promptIndex, seed] of PROMPTS.entries()) {
    const runCount = 6 + Math.floor(random() * 3); // 6-8 runs per prompt

    for (let runIndex = 0; runIndex < runCount; runIndex += 1) {
      runCounter += 1;

      // Most runs are healthy; a minority regress, and one in ~12 fails outright.
      const isInfraFailure = random() < 0.08;
      const regressionSeverity = random();
      const targetDrift = isInfraFailure
        ? 1
        : regressionSeverity > 0.75
          ? 0.4 + random() * 0.4
          : random() * 0.2;

      const failingCases = Math.round(targetDrift * seed.cases.length);
      const actualDrift = seed.cases.length === 0 ? 0 : failingCases / seed.cases.length;
      const status: RunStatus = isInfraFailure ? "FAILED" : "COMPLETED";

      // Runs walk backwards in time, newest last.
      const createdAt = new Date(
        Date.now() - (runCount - runIndex) * 86_400_000 - promptIndex * 3_600_000
      );
      const startedAt = new Date(createdAt.getTime() + 1200);

      const run = await prisma.run.create({
        data: {
          commitSha: fakeSha(1000 + runCounter),
          environment: runIndex % 3 === 0 ? "LOCAL" : "CI",
          status,
          score: actualDrift,
          expectedJobs: 1,
          completedJobs: 1,
          failedJobs: isInfraFailure ? 1 : 0,
          startedAt,
          timeoutAt: new Date(startedAt.getTime() + 15 * 60_000),
          createdAt,
          updatedAt: new Date(createdAt.getTime() + 45_000)
        }
      });

      const results = seed.cases.map((testCase, caseIndex) => {
        const failed = caseIndex < failingCases;
        const assertionType: AssertionType = testCase.deterministic
          ? "DETERMINISTIC"
          : "SEMANTIC";

        // Deterministic checks short-circuit before the model, so they cost
        // nothing and return fast. Semantic checks pay for a judge call.
        const latencyMs = testCase.deterministic
          ? 40 + Math.floor(random() * 260)
          : 700 + Math.floor(random() * 2300);
        const tokensUsed = testCase.deterministic ? 0 : 180 + Math.floor(random() * 640);

        return {
          runId: run.id,
          promptName: seed.name,
          testName: testCase.testName,
          pass: !failed,
          driftScore: failed ? 0.6 + random() * 0.4 : random() * 0.15,
          reasoning: failed
            ? testCase.deterministic
              ? pick(DETERMINISTIC_FAILS)
              : pick(FAIL_REASONS)
            : testCase.deterministic
              ? "All deterministic assertions passed."
              : pick(PASS_REASONS),
          latencyMs,
          tokensUsed,
          assertionType,
          // gpt-4o-mini-ish pricing, rounded for display.
          estimatedCostUsd: tokensUsed === 0 ? 0 : Number((tokensUsed * 0.0000004).toFixed(8)),
          createdAt: new Date(startedAt.getTime() + caseIndex * 900)
        };
      });

      await prisma.result.createMany({ data: results });
      totalResults += results.length;
    }
  }

  const [prompts, versions, runs] = await Promise.all([
    prisma.prompt.count(),
    prisma.promptVersion.count(),
    prisma.run.count()
  ]);

  console.log("");
  console.log("Seed complete:");
  console.log(`  prompts:         ${prompts}`);
  console.log(`  prompt versions: ${versions}`);
  console.log(`  runs:            ${runs}`);
  console.log(`  results:         ${totalResults}`);
  console.log("");
}

main()
  .catch((error: unknown) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
