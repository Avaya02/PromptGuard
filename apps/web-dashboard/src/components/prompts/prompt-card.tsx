import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";

import type { PromptListItem } from "../../lib/types";
import { usePromptRuns } from "../../hooks/use-data";
import { PromptStatusBadge } from "./prompt-status-badge";
import { Panel } from "../common/panel";

interface PromptCardProps {
  prompt: PromptListItem;
}

export function PromptCard({ prompt }: PromptCardProps): JSX.Element {
  const runsQuery = usePromptRuns(prompt.id);
  const latestRun = runsQuery.data?.[0];

  return (
    <Panel className="flex h-full flex-col justify-between gap-4 transition hover:-translate-y-1 hover:shadow-xl">
      <div>
        <div className="mb-3 flex items-start justify-between gap-3">
          <h3 className="text-lg font-semibold text-pg-ink">{prompt.name}</h3>
          <PromptStatusBadge run={latestRun} />
        </div>

        <div className="space-y-1 text-sm text-pg-slate/80">
          <p>Version: v{prompt.latestVersion}</p>
          <p>Updated: {new Date(prompt.updatedAt).toLocaleString()}</p>
          <p>
            Latest drift: {latestRun?.score !== null && latestRun ? latestRun.score.toFixed(3) : "unavailable"}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Link
          to={`/prompts/${prompt.id}`}
          className="inline-flex items-center gap-1 rounded-full bg-pg-ink px-4 py-2 text-sm font-semibold text-white"
        >
          Open prompt
          <ArrowRight className="h-4 w-4" />
        </Link>
        {latestRun ? (
          <Link to={`/runs/${latestRun.id}`} className="text-sm font-semibold text-pg-slate underline">
            Latest run
          </Link>
        ) : null}
      </div>
    </Panel>
  );
}
