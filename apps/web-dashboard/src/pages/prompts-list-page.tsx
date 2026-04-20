import { EmptyState } from "../components/common/empty-state";
import { LoadingState } from "../components/common/loading-state";
import { PromptCard } from "../components/prompts/prompt-card";
import { usePrompts } from "../hooks/use-data";

export function PromptsListPage(): JSX.Element {
  const promptsQuery = usePrompts();

  if (promptsQuery.isLoading) {
    return <LoadingState />;
  }

  if (promptsQuery.isError) {
    return (
      <EmptyState
        title="Unable to load prompts"
        description="Check the API server and VITE_PROMPTGUARD_API_URL configuration."
      />
    );
  }

  const prompts = promptsQuery.data ?? [];

  if (prompts.length === 0) {
    return (
      <EmptyState
        title="No prompts registered"
        description="Run the SDK definePrompt flow and execute a test run to populate dashboard data."
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
