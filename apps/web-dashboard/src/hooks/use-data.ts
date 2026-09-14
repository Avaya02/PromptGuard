import { useMutation, useQuery } from "@tanstack/react-query";

import {
  evaluatePrompt,
  getPromptDetail,
  getPromptRuns,
  getPrompts,
  getRunResults,
  getRunView
} from "../lib/api";

export function usePrompts() {
  return useQuery({
    queryKey: ["prompts"],
    queryFn: getPrompts
  });
}

export function usePromptRuns(promptId: string | undefined) {
  return useQuery({
    queryKey: ["prompt-runs", promptId],
    queryFn: () => getPromptRuns(promptId ?? ""),
    enabled: Boolean(promptId)
  });
}

export function useRunResults(runId: string | undefined) {
  return useQuery({
    queryKey: ["run-results", runId],
    queryFn: () => getRunResults(runId ?? ""),
    enabled: Boolean(runId)
  });
}

export function useRunView(runId: string | undefined) {
  return useQuery({
    queryKey: ["run-view", runId],
    queryFn: () => getRunView(runId ?? ""),
    enabled: Boolean(runId),
    refetchInterval: (query) => {
      const status = query.state.data?.run.status;
      return status === "PENDING" || status === "RUNNING" ? 3000 : false;
    }
  });
}

export function usePromptDetail(promptId: string | undefined) {
  return useQuery({
    queryKey: ["prompt-detail", promptId],
    queryFn: () => getPromptDetail(promptId ?? ""),
    enabled: Boolean(promptId)
  });
}

export function useEvaluate() {
  return useMutation({ mutationFn: evaluatePrompt });
}
