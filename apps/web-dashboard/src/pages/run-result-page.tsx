import { Suspense, lazy, useMemo, useState } from "react";
import { useParams } from "react-router-dom";

import { EmptyState } from "../components/common/empty-state";
import { ErrorState } from "../components/common/error-state";
import { LoadingState } from "../components/common/loading-state";
import { Panel } from "../components/common/panel";
import { FailureCard } from "../components/results/failure-card";
import { RunResultsTable } from "../components/results/run-results-table";
import { useRunView } from "../hooks/use-data";
import { usePageTitle } from "../hooks/use-page-title";
import { useRunEvents } from "../hooks/use-run-events";

const LazyPromptDiffViewer = lazy(async () => {
  const module = await import("../components/results/prompt-diff-viewer");
  return { default: module.PromptDiffViewer };
});

function StatCard({
  label,
  value,
  tone = "neutral"
}: {
  label: string;
  value: string;
  tone?: "neutral" | "good" | "bad";
}): JSX.Element {
  const toneClass =
    tone === "good"
      ? "text-emerald-700"
      : tone === "bad"
        ? "text-red-700"
        : "text-pg-ink";

  return (
    <div className="rounded-xl border border-pg-slate/20 bg-white/70 px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-pg-slate/70">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${toneClass}`}>{value}</p>
    </div>
  );
}

export function RunResultPage(): JSX.Element {
  const { runId } = useParams();
  const runViewQuery = useRunView(runId);
  const [selectedPrompt, setSelectedPrompt] = useState<string | null>(null);

  const run = runViewQuery.data?.run ?? null;
  const isActive = run?.status === "PENDING" || run?.status === "RUNNING";

  // Live progress streams over SSE while the run is in flight. The query above
  // still supplies diffs and the final view; the stream only drives progress.
  const events = useRunEvents(runId, isActive);
  const liveRun = events.run ?? run;

  usePageTitle(runId ? `Run ${runId.slice(0, 8)}` : "Run");

  const promptDiffs = useMemo(() => runViewQuery.data?.promptDiffs ?? [], [runViewQuery.data]);

  // Every hook must run before any early return, or the hook order changes
  // between the loading and loaded renders.
  const activePrompt = useMemo(() => {
    const fallback = promptDiffs[0]?.promptName ?? null;
    const promptName = selectedPrompt ?? fallback;
    return promptDiffs.find((item) => item.promptName === promptName) ?? null;
  }, [promptDiffs, selectedPrompt]);

  if (runViewQuery.isLoading) {
    return <LoadingState />;
  }

  if (runViewQuery.isError || !runViewQuery.data || !liveRun) {
    return (
      <ErrorState
        title="Could not load this run"
        description="The dashboard reached for run details and did not get them back."
        steps={[
          "Confirm the API server is running (GET /health should return status ok).",
          "Check VITE_PROMPTGUARD_API_URL points at that server.",
          "Verify this run id still exists — it may have been deleted."
        ]}
        onRetry={() => void runViewQuery.refetch()}
      />
    );
  }

  const results = events.results ?? runViewQuery.data.results;
  const failedResults = results.filter((result) => !result.pass);
  const passRate = results.length === 0 ? null : (results.length - failedResults.length) / results.length;
  const deterministicCount = results.filter((r) => r.assertionType === "deterministic").length;

  return (
    <div className="space-y-4">
      <Panel>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-pg-slate/80">
              Run Overview
            </p>
            <h2 className="mt-2 break-all text-2xl font-bold text-pg-ink">Run {liveRun.id}</h2>
            <p className="mt-2 text-sm text-pg-slate">
              Commit {liveRun.commitSha.slice(0, 10)} · {liveRun.environment} · {liveRun.status}
            </p>
          </div>

          {events.streaming ? (
            <span className="inline-flex items-center gap-2 rounded-full bg-pg-cyan/20 px-3 py-1 text-xs font-semibold text-pg-ink">
              <span className="h-2 w-2 animate-pulse rounded-full bg-pg-ink" />
              Live · {liveRun.completedJobs}/{liveRun.expectedJobs} prompts · {events.resultCount} results
            </span>
          ) : null}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard
            label="Pass rate"
            value={passRate === null ? "—" : `${Math.round(passRate * 100)}%`}
            tone={passRate === null ? "neutral" : passRate === 1 ? "good" : "bad"}
          />
          <StatCard
            label="Passed"
            value={`${results.length - failedResults.length}/${results.length}`}
          />
          <StatCard label="Drift score" value={liveRun.score?.toFixed(3) ?? "—"} />
          <StatCard label="Zero-cost checks" value={`${deterministicCount}/${results.length}`} />
        </div>

        {events.error ? (
          <p className="mt-3 text-sm text-red-700">{events.error} Showing the last known state.</p>
        ) : null}
      </Panel>

      <Panel>
        <h3 className="mb-3 text-lg font-semibold text-pg-ink">Semantic Diff View</h3>

        {promptDiffs.length === 0 ? (
          <EmptyState
            title="No prompt diffs yet"
            description="Diffs appear once results are stored and the prompt has more than one recorded version."
          />
        ) : (
          <>
            <div className="mb-3 flex flex-wrap gap-2">
              {promptDiffs.map((promptDiff) => {
                const active = activePrompt?.promptName === promptDiff.promptName;
                return (
                  <button
                    key={promptDiff.promptName}
                    type="button"
                    onClick={() => setSelectedPrompt(promptDiff.promptName)}
                    className={`rounded-full px-3 py-1 text-sm font-semibold ${
                      active ? "bg-pg-ink text-white" : "bg-pg-slate/10 text-pg-slate"
                    }`}
                  >
                    {promptDiff.promptName}
                  </button>
                );
              })}
            </div>

            {activePrompt ? (
              <Suspense fallback={<LoadingState />}>
                <LazyPromptDiffViewer before={activePrompt.before} after={activePrompt.after} />
              </Suspense>
            ) : null}
          </>
        )}
      </Panel>

      <Panel>
        <h3 className="mb-3 text-lg font-semibold text-pg-ink">Run Results</h3>
        <div className="overflow-x-auto">
          <RunResultsTable records={results} />
        </div>
      </Panel>

      <Panel>
        <h3 className="mb-3 text-lg font-semibold text-pg-ink">Failures with Judge Reasoning</h3>
        <div className="space-y-2">
          {failedResults.length === 0 ? (
            <p className="text-sm text-pg-slate/80">No failing tests in this run.</p>
          ) : (
            failedResults.map((record) => <FailureCard key={record.id} record={record} />)
          )}
        </div>
      </Panel>
    </div>
  );
}
