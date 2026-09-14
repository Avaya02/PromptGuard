/**
 * Error carrying a user-facing remediation hint.
 *
 * The CLI catches these in `runTestCommand` and prints `message` followed by
 * the indented `hint`, so failures explain the next action rather than leaking
 * a raw `ENOENT` stack.
 */
export class PromptGuardCliError extends Error {
  readonly hint: string;

  constructor(message: string, hint: string) {
    super(message);
    this.name = "PromptGuardCliError";
    this.hint = hint;
  }
}

export function isFileNotFound(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
