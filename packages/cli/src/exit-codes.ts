/**
 * Exit codes are part of the CLI's contract with CI.
 *
 * Separating "a prompt regressed" from "the tool could not run" lets a pipeline
 * treat the first as a failed check and the second as a broken job.
 */
export const EXIT = {
  ok: 0,
  regression: 1,
  error: 2
} as const;
