interface EmptyStateProps {
  title: string;
  description: string;
}

export function EmptyState({ title, description }: EmptyStateProps): JSX.Element {
  return (
    <div className="rounded-2xl border border-dashed border-pg-slate/35 bg-white/50 px-6 py-10 text-center">
      <h3 className="text-lg font-semibold text-pg-ink">{title}</h3>
      <p className="mt-2 text-sm text-pg-slate/80">{description}</p>
    </div>
  );
}
