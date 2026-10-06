// How the app reads a failed answer from the plan API: which failures are worth retrying (the server may still be
// waking up) and what to tell the user.

// Seconds to wait before trying again: the Retry-After header (seconds) if the browser can read it, otherwise the
// "Try again in N seconds" the API puts in its error message (browsers hide Retry-After on cross-origin requests
// unless the server exposes it). null when neither is usable.
export function retryAfterSeconds(retryAfterHeader, message) {
  const fromHeader = Number(retryAfterHeader);
  if (retryAfterHeader != null && String(retryAfterHeader).trim() !== '' && Number.isFinite(fromHeader) && fromHeader >= 0) {
    return fromHeader;
  }
  const match = /try again in (\d+) seconds?/i.exec(message || '');
  return match ? Number(match[1]) : null;
}

export function rateLimitMessage(seconds) {
  if (seconds == null) return 'You have planned a lot of trips. Please try again in a while.';
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return `You have planned a lot of trips. Please try again in about ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`;
}

/**
 * Decide what a non-OK response means.
 *  - 429: the API answered and is rate limiting; show a calm message and never retry.
 *  - an answer with an error message: the app itself replied, so show it and don't retry.
 *  - anything else (e.g. the hosting platform's HTML "waking up" page): retryable.
 */
export function classifyPlanFailure({ status, data, retryAfter }) {
  const message = data?.error?.message || data?.detail;
  if (status === 429) {
    return { retryable: false, message: rateLimitMessage(retryAfterSeconds(retryAfter, message)) };
  }
  if (message) return { retryable: false, message };
  return { retryable: true, message: `Request failed (${status})` };
}

// Per-attempt timeout. While the server has never answered it may be waking from idle, so an attempt gives up after
// 30 s and is retried. Once it has answered, a slow plan (the backend allows up to 60 s for a slow routing service)
// gets 65 s to finish, and there is no retry.
export const COLD_REQUEST_TIMEOUT_MS = 30000;
export const WARM_REQUEST_TIMEOUT_MS = 65000;

export function requestTimeoutMs(serverReached) {
  return serverReached ? WARM_REQUEST_TIMEOUT_MS : COLD_REQUEST_TIMEOUT_MS;
}
