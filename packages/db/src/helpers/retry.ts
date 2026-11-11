/**
 * EC-74 — retry snapshot (or other persistence) writes with exponential backoff.
 * Callers must not block gameplay on the returned promise beyond fire-and-forget
 * scheduling; this helper only encapsulates the retry policy.
 */

export type RetryOptions = {
  readonly maxAttempts: number;
  readonly initialDelayMs: number;
  readonly maxDelayMs: number;
  readonly backoffFactor: number;
  /** Injected sleep for tests; defaults to setTimeout. */
  readonly sleep?: (ms: number) => Promise<void>;
};

const DEFAULT_RETRY: RetryOptions = {
  maxAttempts: 5,
  initialDelayMs: 50,
  maxDelayMs: 2000,
  backoffFactor: 2,
};

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export type RetryResult<T> =
  | { readonly ok: true; readonly value: T; readonly attempts: number }
  | { readonly ok: false; readonly error: unknown; readonly attempts: number };

export async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  options: Partial<RetryOptions> = {},
): Promise<RetryResult<T>> {
  const opts: RetryOptions = { ...DEFAULT_RETRY, ...options };
  const sleep = opts.sleep ?? defaultSleep;
  let delay = opts.initialDelayMs;
  let lastError: unknown;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      const value = await operation();
      return { ok: true, value, attempts: attempt };
    } catch (error) {
      lastError = error;
      if (attempt === opts.maxAttempts) break;
      await sleep(delay);
      delay = Math.min(opts.maxDelayMs, delay * opts.backoffFactor);
    }
  }

  return { ok: false, error: lastError, attempts: opts.maxAttempts };
}
