import type { PrismaClient } from "@prisma/client";

export async function markPromptCompleted(prisma: PrismaClient, runId: string): Promise<void> {
  const updatedRun = await prisma.run.update({
    where: { id: runId },
    data: {
      completedJobs: {
        increment: 1
      }
    }
  });

  if (updatedRun.completedJobs < updatedRun.expectedJobs) {
    return;
  }

  const [total, failed] = await Promise.all([
    prisma.result.count({ where: { runId } }),
    prisma.result.count({ where: { runId, pass: false } })
  ]);

  const score = total === 0 ? 0 : failed / total;
  const status = updatedRun.failedJobs > 0 ? "FAILED" : "COMPLETED";

  await prisma.run.update({
    where: { id: runId },
    data: {
      status,
      score
    }
  });
}

export async function markPromptFailed(prisma: PrismaClient, runId: string): Promise<void> {
  const updatedRun = await prisma.run.update({
    where: { id: runId },
    data: {
      failedJobs: {
        increment: 1
      },
      completedJobs: {
        increment: 1
      },
      status: "FAILED"
    }
  });

  if (updatedRun.completedJobs >= updatedRun.expectedJobs) {
    const [total, failed] = await Promise.all([
      prisma.result.count({ where: { runId } }),
      prisma.result.count({ where: { runId, pass: false } })
    ]);

    const score = total === 0 ? 1 : failed / total;
    await prisma.run.update({
      where: { id: runId },
      data: {
        score
      }
    });
  }
}
