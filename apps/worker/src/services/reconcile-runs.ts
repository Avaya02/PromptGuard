import type { PrismaClient } from "@prisma/client";

export const RUN_TIMEOUT_MS = 15 * 60 * 1000;
export const RECONCILE_INTERVAL_MS = 5 * 60 * 1000;

export interface ReconcileResult {
  timedOutRunIds: string[];
}

/**
 * Fails runs whose deadline has passed while still non-terminal.
 *
 * A worker that dies mid-job never fires a `failed` event, so its run's counters
 * never reach `expectedJobs` and it would sit in RUNNING forever. This is the
 * backstop for that case; the `stalled` handler covers the recoverable one.
 */
export async function reconcileStuckRuns(
  prisma: PrismaClient,
  now: Date = new Date()
): Promise<ReconcileResult> {
  const stuck = await prisma.run.findMany({
    where: {
      status: { in: ["RUNNING", "PENDING"] },
      timeoutAt: { not: null, lt: now }
    },
    select: { id: true }
  });

  if (stuck.length === 0) {
    return { timedOutRunIds: [] };
  }

  const ids = stuck.map((run) => run.id);

  await prisma.run.updateMany({
    where: { id: { in: ids } },
    data: { status: "FAILED" }
  });

  return { timedOutRunIds: ids };
}

/**
 * Starts the periodic reconciler.
 *
 * `unref()` keeps the timer from holding the process open during shutdown.
 */
export function startRunReconciler(
  prisma: PrismaClient,
  options: { intervalMs?: number; onError?: (error: unknown) => void } = {}
): () => void {
  const intervalMs = options.intervalMs ?? RECONCILE_INTERVAL_MS;

  const timer = setInterval(() => {
    void reconcileStuckRuns(prisma).catch((error: unknown) => {
      options.onError?.(error);
    });
  }, intervalMs);

  timer.unref?.();

  return () => {
    clearInterval(timer);
  };
}
