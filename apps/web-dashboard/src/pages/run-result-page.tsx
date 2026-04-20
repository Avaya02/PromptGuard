import { Suspense, lazy, useMemo, useState } from "react";
import { useParams } from "react-router-dom";

import { EmptyState } from "../components/common/empty-state";
import { LoadingState } from "../components/common/loading-state";
import { Panel } from "../components/common/panel";
import { FailureCard } from "../components/results/failure-card";
import { RunResultsTable } from "../components/results/run-results-table";
import { useRunView } from "../hooks/use-data";

const LazyPromptDiffViewer = lazy(async () => {
  const module = await import("../components/results/prompt-diff-viewer");
  return { default: module.PromptDiffViewer };
});

export function RunResultPage(): JSX.Element {
  const { runId } = useParams();
  const runViewQuery = useRunView(runId);
  const [selectedPrompt, setSelectedPrompt] = useState<string | null>(null);

  if (runViewQuery.isLoading) {
    return <LoadingState />;
  }

  if (runViewQuery.isError || !runViewQuery.data) {
    return <EmptyState title="Run not found" description="Unable to load run details from API." />;
  }

  const { run, results, promptDiffs } = runViewQuery.data;
  const failedResults = results.filter((result) => !result.pass);
  const promptNames = promptDiffs.map((item) => item.promptName);

  const activePrompt = useMemo(() => {
    const fallbackPrompt = promptNames[0] ?? null;
    const promptName = selectedPrompt ?? fallbackPrompt;
    return promptDiffs.find((item) => item.promptName === promptName) ?? null;
  }, [promptDiffs, promptNames, selectedPrompt]);

  return (
    <div className="space-y-4">
      <Panel>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-pg-slate/80">Run Overview</p>
        <h2 className="mt-2 text-2xl font-bold text-pg-ink">Run {run.id}</h2>
        <p className="mt-2 text-sm text-pg-slate">
          Commit {run.commitSha} · Status {run.status} · Score {run.score?.toFixed(3) ?? "n/a"}
        </p>
      </Panel>

      <Panel>
        <h3 className="mb-3 text-lg font-semibold text-pg-ink">Semantic Diff View</h3>

        {promptDiffs.length === 0 ? (
          <EmptyState title="No prompt diffs" description="Prompt diff data becomes available after results are stored." />
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
        <RunResultsTable records={results} />
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
