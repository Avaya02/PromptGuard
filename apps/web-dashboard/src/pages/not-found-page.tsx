import { Link } from "react-router-dom";

import { EmptyState } from "../components/common/empty-state";
import { usePageTitle } from "../hooks/use-page-title";

export function NotFoundPage(): JSX.Element {
  usePageTitle("Not found");

  return (
    <div className="space-y-4">
      <EmptyState
        title="Page not found"
        description="This route does not exist in PromptGuard dashboard."
      />
      <Link
        to="/"
        className="inline-flex rounded-full bg-pg-ink px-4 py-2 text-sm font-semibold text-white"
      >
        Return to prompts
      </Link>
    </div>
  );
}
