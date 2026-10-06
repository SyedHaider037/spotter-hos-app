import {
  classifyPlanFailure,
  COLD_REQUEST_TIMEOUT_MS,
  rateLimitMessage,
  requestTimeoutMs,
  retryAfterSeconds,
  WARM_REQUEST_TIMEOUT_MS,
} from './planApi';

const tooMany = (message = 'Too many trip plans from this address. Try again in 1235 seconds.') => ({
  error: { code: 'RATE_LIMITED', message },
});

describe('classifyPlanFailure', () => {
  test('a 429 with Retry-After says how many minutes, rounded up, and is not retried', () => {
    expect(classifyPlanFailure({ status: 429, data: tooMany(), retryAfter: '1235' })).toEqual({
      retryable: false,
      message: 'You have planned a lot of trips. Please try again in about 21 minutes.',
    });
  });

  test('a 429 without the header falls back to the seconds in the error message', () => {
    const result = classifyPlanFailure({ status: 429, data: tooMany(), retryAfter: null });
    expect(result.retryable).toBe(false);
    expect(result.message).toBe('You have planned a lot of trips. Please try again in about 21 minutes.');
  });

  test('a 429 with no usable time says to try again in a while', () => {
    for (const retryAfter of [null, undefined, '', 'soon']) {
      expect(classifyPlanFailure({ status: 429, data: tooMany('Slow down.'), retryAfter })).toEqual({
        retryable: false,
        message: 'You have planned a lot of trips. Please try again in a while.',
      });
    }
  });

  test('a 429 with no JSON body is still a rate limit, not a retry', () => {
    expect(classifyPlanFailure({ status: 429, data: null, retryAfter: '60' })).toEqual({
      retryable: false,
      message: 'You have planned a lot of trips. Please try again in about 1 minute.',
    });
  });

  test('an error the app itself answered with is shown as is and not retried', () => {
    expect(classifyPlanFailure({ status: 400, data: { error: { message: 'Bad cycle.' } } })).toEqual({
      retryable: false,
      message: 'Bad cycle.',
    });
  });

  test('a platform error page (no JSON message) is still retried', () => {
    expect(classifyPlanFailure({ status: 503, data: null })).toEqual({ retryable: true, message: 'Request failed (503)' });
  });
});

describe('retry-after helpers', () => {
  test('the header wins over the message', () => {
    expect(retryAfterSeconds('90', 'Try again in 5 seconds.')).toBe(90);
  });

  test('rounds up to whole minutes, at least one', () => {
    expect(rateLimitMessage(1)).toMatch(/about 1 minute\./);
    expect(rateLimitMessage(60)).toMatch(/about 1 minute\./);
    expect(rateLimitMessage(61)).toMatch(/about 2 minutes\./);
    expect(rateLimitMessage(0)).toMatch(/about 1 minute\./);
  });
});

describe('requestTimeoutMs', () => {
  test('a server that has never answered gets the short timeout, so a sleeping one is retried quickly', () => {
    expect(requestTimeoutMs(false)).toBe(30000);
  });

  test('once it has answered, a slow plan gets longer than the backend allows (60 s)', () => {
    expect(requestTimeoutMs(true)).toBe(65000);
    expect(WARM_REQUEST_TIMEOUT_MS).toBeGreaterThan(60000);
  });

  test('the worst-case wait for a sleeping server is unchanged (7 attempts, 10 s apart, 30 s each)', () => {
    const attempts = 7;
    const retryDelayMs = 10000;
    expect(attempts * COLD_REQUEST_TIMEOUT_MS + (attempts - 1) * retryDelayMs).toBeLessThanOrEqual(270000);
  });
});
