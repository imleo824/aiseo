import { describe, expect, it } from 'vitest';
import {
  CircuitBreakerError,
  ConflictError,
  ExternalServiceError,
  ForbiddenError,
  InsufficientCreditsError,
  NotFoundError,
  RateLimitError,
  UnauthorizedError,
  ValidationError
} from './errors';

describe('application error contract', () => {
  it.each([
    [NotFoundError, 404, 'RESOURCE_NOT_FOUND'],
    [ValidationError, 400, 'VALIDATION_FAILED'],
    [ConflictError, 409, 'RESOURCE_CONFLICT'],
    [CircuitBreakerError, 503, 'CIRCUIT_BREAKER_OPEN'],
    [ExternalServiceError, 502, 'EXTERNAL_SERVICE_ERROR'],
    [RateLimitError, 429, 'RATE_LIMIT_EXCEEDED'],
    [UnauthorizedError, 401, 'UNAUTHORIZED'],
    [ForbiddenError, 403, 'FORBIDDEN'],
    [InsufficientCreditsError, 402, 'INSUFFICIENT_CREDITS']
  ])('serializes %s with a stable API contract', (ErrorType, statusCode, errorCode) => {
    const error = new ErrorType('safe message', { field: 'amount' });
    expect(error.toJSON('trace-1')).toMatchObject({
      success: false,
      error: { code: errorCode, statusCode, message: 'safe message', details: { field: 'amount' }, traceId: 'trace-1' }
    });
    expect(error.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
