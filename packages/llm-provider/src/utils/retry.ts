export interface RetryOptions {
  /** Total attempts including the first. */
  attempts?: number;
  /** Base delay in ms; doubles each attempt. */
  baseDelayMs?: number;
  /** Ceiling for a single backoff wait. */
  maxDelayMs?: number;
  signal?: AbortSignal | undefined;
}

export const DEFAULT_RETRY_ATTEMPTS = 3;
export const DEFAULT_RETRY_BASE_DELAY_MS = 500;
export const DEFAULT_RETRY_MAX_DELAY_MS = 8000;

/** Marks an HTTP failure so retry logic can inspect the status code. */
export class HttpError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, body: string, message?: string) {
    super(message ?? `Request failed with status ${status}`);
    this.name = "HttpError";
    this.status = status;
    this.body = body;
  }
}

/** 429 and 5xx are transient; everything else is a caller error worth surfacing fast. */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 503 || status === 502 || status === 504 || status === 500;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new Error("Aborted"));
      },
      { once: true }
    );
  });
}

/**
 * Runs `operation` with exponential backoff on transient HTTP failures.
 *
 * Honours a `Retry-After` header when the provider sends one, since providers
 * know their own reset window better than a fixed schedule does.
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const attempts = options.attempts ?? DEFAULT_RETRY_ATTEMPTS;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_RETRY_MAX_DELAY_MS;

  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      const isLastAttempt = attempt === attempts - 1;
      const retryable = error instanceof HttpError && isRetryableStatus(error.status);

      if (!retryable || isLastAttempt) {
        throw error;
      }

      const backoff = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
      // Jitter avoids a thundering herd when many cases retry together.
      const jitter = Math.random() * (backoff * 0.25);
      await sleep(backoff + jitter, options.signal);
    }
  }

  throw lastError;
}

export function retryAfterMs(headers: Headers): number | undefined {
  const header = headers.get("retry-after");
  if (!header) {
    return undefined;
  }

  const seconds = Number(header);
  return Number.isFinite(seconds) ? seconds * 1000 : undefined;
}
