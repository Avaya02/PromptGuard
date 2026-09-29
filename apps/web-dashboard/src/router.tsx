import { Navigate, Route, Routes } from "react-router-dom";

import { DashboardShell } from "./components/layout/dashboard-shell";
import { NotFoundPage } from "./pages/not-found-page";
import { PlaygroundPage } from "./pages/playground-page";
import { PromptDetailPage } from "./pages/prompt-detail-page";
import { PromptsListPage } from "./pages/prompts-list-page";
import { RunResultPage } from "./pages/run-result-page";

export function AppRouter(): JSX.Element {
  return (
    <DashboardShell>
      <Routes>
        <Route path="/" element={<PromptsListPage />} />
        <Route path="/prompts/:promptId" element={<PromptDetailPage />} />
        <Route path="/runs/:runId" element={<RunResultPage />} />
        <Route path="/playground" element={<PlaygroundPage />} />
        <Route path="/prompts" element={<Navigate to="/" replace />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </DashboardShell>
  );
}
