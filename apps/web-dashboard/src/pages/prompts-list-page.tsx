import { EmptyState } from "../components/common/empty-state";
import { ErrorState } from "../components/common/error-state";
import { LoadingState } from "../components/common/loading-state";
import { PromptCard } from "../components/prompts/prompt-card";
import { usePrompts } from "../hooks/use-data";
import { usePageTitle } from "../hooks/use-page-title";

export function PromptsListPage(): JSX.Element {
  usePageTitle("Prompts");
  const promptsQuery = usePrompts();

  if (promptsQuery.isLoading) {
    return <LoadingState />;
  }

  if (promptsQuery.isError) {
    return (
      <ErrorState
        title="Could not reach the API"
        description="The dashboard asked the API for the prompt catalog and got no usable response."
        steps={[
          "Start the stack: docker compose up",
          "Confirm the API answers: curl http://localhost:4000/health",
          "If the API runs elsewhere, set VITE_PROMPTGUARD_API_URL and rebuild the dashboard."
        ]}
        onRetry={() => void promptsQuery.refetch()}
      />
    );
  }

  const prompts = promptsQuery.data ?? [];

  if (prompts.length === 0) {
    return (
      <EmptyState
        title="No prompts registered yet"
        description="Seed the demo data with `docker compose exec api-server pnpm seed`, or register a prompt from your own code with definePrompt() and run `prompt-guard test`."
      />
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-pg-slate/80">Prompt Inventory</p>
        <h2 className="mt-2 text-3xl font-bold text-pg-ink">Active Prompt Catalog</h2>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {prompts.map((prompt) => (
          <PromptCard key={prompt.id} prompt={prompt} />
        ))}
      </div>
    </div>
  );
}
