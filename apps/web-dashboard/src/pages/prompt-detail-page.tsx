import { Link, useParams } from "react-router-dom";

import { DriftScoreChart } from "../components/charts/drift-score-chart";
import { EmptyState } from "../components/common/empty-state";
import { LoadingState } from "../components/common/loading-state";
import { Panel } from "../components/common/panel";
import { usePromptRuns, usePrompts } from "../hooks/use-data";

export function PromptDetailPage(): JSX.Element {
  const { promptId } = useParams();
  const promptsQuery = usePrompts();
  const runsQuery = usePromptRuns(promptId);

  if (promptsQuery.isLoading || runsQuery.isLoading) {
    return <LoadingState />;
  }

  if (promptsQuery.isError || runsQuery.isError || !promptId) {
    return (
      <EmptyState
        title="Unable to load prompt details"
        description="The prompt could not be loaded from the current API connection."
      />
    );
  }

  const prompt = promptsQuery.data?.find((item) => item.id === promptId);
  const runs = runsQuery.data ?? [];

  if (!prompt) {
    return <EmptyState title="Prompt not found" description="The selected prompt does not exist." />;
  }

  const chartData = runs
    .slice()
    .reverse()
    .map((run) => ({
      date: new Date(run.createdAt).toLocaleDateString(),
      score: run.score ?? 0
    }));

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-pg-slate/80">Prompt Details</p>
        <h2 className="mt-2 text-3xl font-bold text-pg-ink">{prompt.name}</h2>
      </div>

      <Panel>
        <h3 className="mb-3 text-lg font-semibold text-pg-ink">Drift Trend</h3>
        {chartData.length > 0 ? (
          <DriftScoreChart data={chartData} />
        ) : (
          <EmptyState title="No run history" description="Run prompt tests to render trend lines." />
        )}
      </Panel>

      <Panel>
        <h3 className="mb-3 text-lg font-semibold text-pg-ink">Historical Runs</h3>
        <div className="space-y-2">
          {runs.length === 0 ? (
            <p className="text-sm text-pg-slate/80">No runs recorded for this prompt.</p>
          ) : (
            runs.map((run) => (
              <Link
                key={run.id}
                to={`/runs/${run.id}`}
                className="flex items-center justify-between rounded-lg border border-pg-slate/20 bg-white px-3 py-2 text-sm hover:border-pg-slate/45"
              >
                <span className="font-semibold text-pg-ink">{run.commitSha}</span>
                <span className="text-pg-slate">score {run.score?.toFixed(3) ?? "n/a"}</span>
              </Link>
            ))
          )}
        </div>
      </Panel>
    </div>
  );
}
