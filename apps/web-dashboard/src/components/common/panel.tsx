import type { PropsWithChildren } from "react";

interface PanelProps extends PropsWithChildren {
  className?: string;
}

export function Panel({ children, className }: PanelProps): JSX.Element {
  return (
    <section
      className={`rounded-2xl border border-white/60 bg-white/80 p-5 shadow-panel backdrop-blur ${className ?? ""}`}
    >
      {children}
    </section>
  );
}
