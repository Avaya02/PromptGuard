import type { RunSummary } from "@promptguard/shared-types";

interface PromptStatusBadgeProps {
  run?: RunSummary | undefined;
}

const statusMap: Record<RunSummary["status"], { label: string; classes: string }> = {
  PENDING: { label: "Pending", classes: "bg-slate-200 text-slate-700" },
  RUNNING: { label: "Running", classes: "bg-cyan-100 text-cyan-800" },
  COMPLETED: { label: "Completed", classes: "bg-emerald-100 text-emerald-800" },
  FAILED: { label: "Failed", classes: "bg-rose-100 text-rose-800" }
};

export function PromptStatusBadge({ run }: PromptStatusBadgeProps): JSX.Element {
  if (!run) {
    return <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">No runs</span>;
  }

  const meta = statusMap[run.status];
  return <span className={`rounded-full px-3 py-1 text-xs font-semibold ${meta.classes}`}>{meta.label}</span>;
}
