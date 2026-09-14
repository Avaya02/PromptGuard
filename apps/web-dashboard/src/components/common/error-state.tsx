import { AlertTriangle } from "lucide-react";

interface ErrorStateProps {
  title: string;
  /** What went wrong, in plain language. */
  description: string;
  /** Concrete steps the reader can take, in the order worth trying. */
  steps?: string[];
  onRetry?: () => void;
}

/**
 * Failure state that tells the reader what to do next.
 *
 * A bare "Unable to load" leaves someone guessing whether the API is down,
 * misconfigured, or simply empty, so every failure surface names the likely
 * causes explicitly.
 */
export function ErrorState({ title, description, steps, onRetry }: ErrorStateProps): JSX.Element {
  return (
    <div className="rounded-2xl border border-red-200 bg-red-50/70 px-5 py-6">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
        <div className="min-w-0">
          <h3 className="text-lg font-semibold text-red-900">{title}</h3>
          <p className="mt-1 text-sm text-red-800">{description}</p>

          {steps && steps.length > 0 ? (
            <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-red-800">
              {steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          ) : null}

          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="mt-4 rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700"
            >
              Retry
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
