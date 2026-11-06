import type { TokenUsage } from "../shared/types";
export class ProviderError extends Error {
  constructor(
    message: string,
    public retryable = false,
    public retryAfterMs = 0,
    public usage?: TokenUsage,
  ) {
    super(message);
  }
}
export function retryDelay(error: unknown, attempt: number): number | null {
  const retryable =
    error instanceof ProviderError
      ? error.retryable
      : error instanceof TypeError ||
        (error instanceof Error &&
          ["TimeoutError", "AbortError"].includes(error.name));
  if (!retryable) return null;
  const requested = error instanceof ProviderError ? error.retryAfterMs : 0;
  // Do not retry earlier than Retry-After; long waits require a later manual retry.
  if (requested > 10000) return null;
  return Math.max(
    requested,
    Math.min(4000, 500 * 2 ** attempt) + Math.floor(Math.random() * 200),
  );
}
export const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
