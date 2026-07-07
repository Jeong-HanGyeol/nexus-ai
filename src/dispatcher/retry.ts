export interface RetryOptions {
  maxAttempts: number;
  delayMs: number;
  backoffFactor?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retries an async operation with optional exponential backoff.
 * Rethrows the last error once maxAttempts is exhausted, so callers decide
 * how to handle final failure (e.g. publish an error event).
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions,
  onAttemptFailed?: (attempt: number, error: unknown) => void,
): Promise<T> {
  let attempt = 0;
  let delay = options.delayMs;

  for (;;) {
    attempt += 1;
    try {
      return await fn();
    } catch (error) {
      if (attempt >= options.maxAttempts) {
        throw error;
      }
      onAttemptFailed?.(attempt, error);
      await sleep(delay);
      delay *= options.backoffFactor ?? 1;
    }
  }
}
