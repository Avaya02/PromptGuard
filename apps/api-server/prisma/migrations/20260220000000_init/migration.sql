CREATE TYPE "RunEnvironment" AS ENUM ('LOCAL', 'CI', 'PROD');
CREATE TYPE "RunStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

CREATE TABLE "prompts" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "latest_version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "prompts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "prompts_name_key" ON "prompts"("name");

CREATE TABLE "prompt_versions" (
  "id" TEXT NOT NULL,
  "prompt_id" TEXT NOT NULL,
  "commit_sha" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "hash" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "prompt_versions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "prompt_versions_prompt_id_idx" ON "prompt_versions"("prompt_id");

ALTER TABLE "prompt_versions"
ADD CONSTRAINT "prompt_versions_prompt_id_fkey"
FOREIGN KEY ("prompt_id") REFERENCES "prompts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "runs" (
  "id" TEXT NOT NULL,
  "commit_sha" TEXT NOT NULL,
  "environment" "RunEnvironment" NOT NULL,
  "score" DOUBLE PRECISION,
  "status" "RunStatus" NOT NULL DEFAULT 'PENDING',
  "expected_jobs" INTEGER NOT NULL DEFAULT 0,
  "completed_jobs" INTEGER NOT NULL DEFAULT 0,
  "failed_jobs" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "results" (
  "id" TEXT NOT NULL,
  "run_id" TEXT NOT NULL,
  "prompt_name" TEXT NOT NULL,
  "test_name" TEXT NOT NULL,
  "pass" BOOLEAN NOT NULL,
  "drift_score" DOUBLE PRECISION NOT NULL,
  "reasoning" TEXT NOT NULL,
  "latency_ms" INTEGER NOT NULL,
  "tokens_used" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "results_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "results_run_id_idx" ON "results"("run_id");
CREATE INDEX "results_prompt_name_idx" ON "results"("prompt_name");

ALTER TABLE "results"
ADD CONSTRAINT "results_run_id_fkey"
FOREIGN KEY ("run_id") REFERENCES "runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
