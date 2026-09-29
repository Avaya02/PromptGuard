// Only the core editor worker is registered. The diff viewer renders plain
// text, so the JSON/CSS/HTML/TypeScript language services — and the several
// megabytes of workers behind them — are never needed.
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";

interface MonacoEnvironmentWindow extends Window {
  MonacoEnvironment?: {
    getWorker: (workerId: string, label: string) => Worker;
  };
}

export function setupMonacoEnvironment(): void {
  const windowWithMonaco = window as MonacoEnvironmentWindow;

  if (windowWithMonaco.MonacoEnvironment) {
    return;
  }

  windowWithMonaco.MonacoEnvironment = {
    getWorker: () => new EditorWorker()
  };
}
