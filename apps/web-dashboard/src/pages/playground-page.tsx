import { useState } from "react";

import { EmptyState } from "../components/common/empty-state";
import { Panel } from "../components/common/panel";
import { useEvaluate, usePromptDetail, usePrompts } from "../hooks/use-data";
import { usePageTitle } from "../hooks/use-page-title";
import { ApiError } from "../lib/api";

function Metric({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="rounded-xl border border-pg-slate/20 bg-white/70 px-3 py-2">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-pg-slate/70">{label}</p>
      <p className="mt-1 text-lg font-semibold text-pg-ink">{value}</p>
    </div>
  );
}

export function PlaygroundPage(): JSX.Element {
  usePageTitle("Playground");

  const promptsQuery = usePrompts();
  const [selectedPromptId, setSelectedPromptId] = useState("");
  const promptDetailQuery = usePromptDetail(selectedPromptId || undefined);

  const [promptText, setPromptText] = useState("");
  const [input, setInput] = useState("");
  const [expectText, setExpectText] = useState("");

  const evaluate = useEvaluate();
  const result = evaluate.data?.result;

  // Selecting a registered prompt loads its latest content, which stays
  // editable so you can try a change before committing it.
  const handleSelectPrompt = (promptId: string): void => {
    setSelectedPromptId(promptId);

    if (!promptId) {
      return;
    }

    const detail = promptDetailQuery.data;
    if (detail?.id === promptId && detail.versions[0]) {
      setPromptText(detail.versions[0].content);
    }
  };

  const loadedContent = promptDetailQuery.data?.versions[0]?.content;
  const canLoad = Boolean(loadedContent) && loadedContent !== promptText;

  const handleSubmit = (event: React.FormEvent): void => {
    event.preventDefault();

    evaluate.mutate({
      prompt: promptText,
      input,
      ...(expectText.trim() ? { expect: expectText.trim() } : {})
    });
  };

  const errorMessage =
    evaluate.error instanceof ApiError
      ? evaluate.error.message
      : evaluate.error
        ? "Evaluation failed."
        : null;

  return (
    <div className="space-y-4">
      <Panel>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-pg-slate/80">Playground</p>
        <h2 className="mt-2 text-2xl font-bold text-pg-ink">Evaluate a prompt live</h2>
        <p className="mt-2 text-sm text-pg-slate">
          Runs a single case through the same evaluator the CI pipeline uses. With no provider
          configured this uses the offline mock provider, so it costs nothing.
        </p>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label
                htmlFor="prompt-select"
                className="text-xs font-semibold uppercase tracking-[0.14em] text-pg-slate/80"
              >
                Registered prompt
              </label>
              <div className="mt-1 flex flex-col gap-2 sm:flex-row">
                <select
                  id="prompt-select"
                  value={selectedPromptId}
                  onChange={(event) => handleSelectPrompt(event.target.value)}
                  className="w-full rounded-lg border border-pg-slate/30 bg-white px-3 py-2 text-sm"
                >
                  <option value="">Start from scratch</option>
                  {(promptsQuery.data ?? []).map((prompt) => (
                    <option key={prompt.id} value={prompt.id}>
                      {prompt.name} (v{prompt.latestVersion})
                    </option>
                  ))}
                </select>

                {canLoad ? (
                  <button
                    type="button"
                    onClick={() => setPromptText(loadedContent ?? "")}
                    className="shrink-0 rounded-lg bg-pg-slate/10 px-3 py-2 text-sm font-semibold text-pg-ink"
                  >
                    Load latest
                  </button>
                ) : null}
              </div>
            </div>

            <div>
              <label
                htmlFor="prompt-text"
                className="text-xs font-semibold uppercase tracking-[0.14em] text-pg-slate/80"
              >
                System prompt
              </label>
              <textarea
                id="prompt-text"
                required
                rows={6}
                value={promptText}
                onChange={(event) => setPromptText(event.target.value)}
                placeholder="You are a helpful support agent…"
                className="mt-1 w-full rounded-lg border border-pg-slate/30 bg-white px-3 py-2 font-mono text-sm"
              />
            </div>

            <div>
              <label
                htmlFor="input-text"
                className="text-xs font-semibold uppercase tracking-[0.14em] text-pg-slate/80"
              >
                Test input
              </label>
              <textarea
                id="input-text"
                required
                rows={3}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="My order arrived damaged."
                className="mt-1 w-full rounded-lg border border-pg-slate/30 bg-white px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label
                htmlFor="expect-text"
                className="text-xs font-semibold uppercase tracking-[0.14em] text-pg-slate/80"
              >
                Judge rubric <span className="normal-case text-pg-slate/60">(optional)</span>
              </label>
              <textarea
                id="expect-text"
                rows={2}
                value={expectText}
                onChange={(event) => setExpectText(event.target.value)}
                placeholder="Apologises and offers a refund without blaming the customer."
                className="mt-1 w-full rounded-lg border border-pg-slate/30 bg-white px-3 py-2 text-sm"
              />
            </div>

            <button
              type="submit"
              disabled={evaluate.isPending || !promptText || !input}
              className="w-full rounded-lg bg-pg-ink px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
            >
              {evaluate.isPending ? "Evaluating…" : "Run evaluation"}
            </button>
          </form>
        </Panel>

        <Panel>
          <h3 className="mb-3 text-lg font-semibold text-pg-ink">Result</h3>

          {errorMessage ? (
            <EmptyState
              title="Evaluation failed"
              description={`${errorMessage} Check that the API server is running and that any provider API key is set.`}
            />
          ) : !result ? (
            <EmptyState
              title="No result yet"
              description="Fill in a prompt and an input, then run the evaluation."
            />
          ) : (
            <div className="space-y-3">
              <div
                className={`rounded-xl px-4 py-3 text-sm font-semibold ${
                  result.pass ? "bg-emerald-100 text-emerald-900" : "bg-red-100 text-red-900"
                }`}
              >
                {result.pass ? "PASS" : "FAIL"}
                <span className="ml-2 font-normal">
                  judged by {result.assertionType === "deterministic" ? "local assertions" : "LLM judge"}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Metric label="Drift" value={result.driftScore.toFixed(3)} />
                <Metric label="Latency" value={`${result.latencyMs} ms`} />
                <Metric label="Tokens" value={String(result.tokensUsed)} />
                <Metric
                  label="Cost"
                  value={
                    result.estimatedCostUsd === undefined || result.estimatedCostUsd === null
                      ? "n/a"
                      : `$${result.estimatedCostUsd.toFixed(6)}`
                  }
                />
              </div>

              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-pg-slate/70">
                  Reasoning
                </p>
                <p className="mt-1 whitespace-pre-wrap rounded-xl border border-pg-slate/20 bg-white/70 px-3 py-2 text-sm text-pg-ink">
                  {result.reason}
                </p>
              </div>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
