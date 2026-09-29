import { useEffect, useRef } from "react";
// editor.api excludes every language contribution; importing "monaco-editor"
// instead would pull ~80 language grammars into this chunk.
import * as monaco from "monaco-editor/esm/vs/editor/editor.api.js";

import { setupMonacoEnvironment } from "../../monaco/setup";

interface PromptDiffViewerProps {
  before: string | null;
  after: string;
}

export function PromptDiffViewer({ before, after }: PromptDiffViewerProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setupMonacoEnvironment();

    if (!containerRef.current) {
      return;
    }

    const originalModel = monaco.editor.createModel(before ?? "", "plaintext");
    const modifiedModel = monaco.editor.createModel(after, "plaintext");

    const editor = monaco.editor.createDiffEditor(containerRef.current, {
      automaticLayout: true,
      readOnly: true,
      renderSideBySide: true,
      minimap: { enabled: false },
      fontSize: 13,
      lineNumbersMinChars: 3,
      roundedSelection: false,
      smoothScrolling: true
    });

    editor.setModel({
      original: originalModel,
      modified: modifiedModel
    });

    return () => {
      editor.dispose();
      originalModel.dispose();
      modifiedModel.dispose();
    };
  }, [before, after]);

  return <div ref={containerRef} className="h-[420px] w-full overflow-hidden rounded-xl border border-pg-slate/30" />;
}
