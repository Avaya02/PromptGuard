import { ChevronDown } from "lucide-react";

import type { RunResultRecord } from "@promptguard/shared-types";

interface FailureCardProps {
  record: RunResultRecord;
}

export function FailureCard({ record }: FailureCardProps): JSX.Element {
  return (
    <details className="rounded-xl border border-rose-200 bg-rose-50/80 p-3" open>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-rose-900">{record.testName}</p>
          <p className="text-xs text-rose-800/80">Drift: {record.driftScore.toFixed(3)}</p>
        </div>
        <ChevronDown className="h-4 w-4 text-rose-900" />
      </summary>
      <p className="mt-3 rounded-lg bg-white/80 p-3 text-sm leading-6 text-rose-950">{record.reasoning}</p>
      <p className="mt-2 text-xs text-rose-900/70">
        Latency {record.latencyMs}ms · Tokens {record.tokensUsed}
      </p>
    </details>
  );
}
