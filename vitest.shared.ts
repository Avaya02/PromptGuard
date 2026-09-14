import type { UserConfig } from "vitest/config";

/**
 * Shared Vitest settings.
 *
 * Coverage thresholds are enforced per package so a regression in one package
 * cannot be masked by good coverage elsewhere.
 */
export const sharedTestConfig: UserConfig["test"] = {
  environment: "node",
  globals: false,
  include: ["src/**/*.test.ts", "test/**/*.test.ts"],
  coverage: {
    provider: "v8",
    reporter: ["text", "json-summary", "lcov"],
    include: ["src/**/*.ts"],
    exclude: [
      "src/**/*.test.ts",
      "src/**/index.ts",
      "src/bin/**",
      "src/server.ts",
      // Infrastructure wiring: these construct live Prisma/BullMQ clients on
      // import, so exercising them requires real services, not unit tests.
      "src/lib/prisma.ts",
      "src/lib/queues.ts",
      "**/*.d.ts"
    ],
    thresholds: {
      lines: 75,
      functions: 75,
      branches: 70,
      statements: 75
    }
  }
};
