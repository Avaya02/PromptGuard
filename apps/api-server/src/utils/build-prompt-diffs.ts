import type { PrismaClient } from "@prisma/client";

import type { PromptDiffRecord } from "@promptguard/shared-types";

export async function buildPromptDiffs(
  prisma: PrismaClient,
  runId: string,
  commitSha: string
): Promise<PromptDiffRecord[]> {
  const promptRows = await prisma.result.findMany({
    where: { runId },
    select: { promptName: true },
    distinct: ["promptName"],
    orderBy: { promptName: "asc" }
  });

  return Promise.all(
    promptRows.map(async ({ promptName }) => {
      const prompt = await prisma.prompt.findUnique({
        where: { name: promptName },
        select: { id: true }
      });

      if (!prompt) {
        return {
          promptName,
          before: null,
          after: ""
        };
      }

      const versions = await prisma.promptVersion.findMany({
        where: { promptId: prompt.id },
        orderBy: { createdAt: "desc" },
        take: 30
      });

      const current = versions.find((version) => version.commitSha === commitSha) ?? versions[0];

      if (!current) {
        return {
          promptName,
          before: null,
          after: ""
        };
      }

      const previous =
        versions.find((version) => version.createdAt < current.createdAt && version.id !== current.id) ??
        versions.find((version) => version.id !== current.id);

      return {
        promptName,
        before: previous?.content ?? null,
        after: current.content
      };
    })
  );
}
