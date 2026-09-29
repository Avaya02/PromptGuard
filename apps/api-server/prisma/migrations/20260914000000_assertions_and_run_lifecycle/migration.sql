-- CreateEnum
CREATE TYPE "AssertionType" AS ENUM ('DETERMINISTIC', 'SEMANTIC');

-- AlterTable
ALTER TABLE "runs" ADD COLUMN     "started_at" TIMESTAMP(3),
ADD COLUMN     "timeout_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "results" ADD COLUMN     "assertion_type" "AssertionType" NOT NULL DEFAULT 'SEMANTIC',
ADD COLUMN     "estimated_cost_usd" DOUBLE PRECISION;

-- CreateIndex
CREATE INDEX "runs_status_timeout_at_idx" ON "runs"("status", "timeout_at");

