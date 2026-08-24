export abstract class AppError extends Error {
  public abstract readonly statusCode: number;
  public abstract readonly errorCode: string;
  public readonly details?: any;
  public readonly timestamp: string;

  constructor(message: string, details?: any) {
    super(message);
    this.name = this.constructor.name;
    this.details = details;
    this.timestamp = new Date().toISOString();
    Error.captureStackTrace(this, this.constructor);
  }

  public toJSON(traceId?: string) {
    return {
      success: false,
      error: {
        code: this.errorCode,
        message: this.message,
        details: this.details,
        statusCode: this.statusCode,
        timestamp: this.timestamp,
        traceId
      }
    };
  }
}

export class NotFoundError extends AppError {
  public readonly statusCode = 404;
  public readonly errorCode = 'RESOURCE_NOT_FOUND';
}

export class ValidationError extends AppError {
  public readonly statusCode = 400;
  public readonly errorCode = 'VALIDATION_FAILED';
}

export class ConflictError extends AppError {
  public readonly statusCode = 409;
  public readonly errorCode = 'RESOURCE_CONFLICT';
}

export class CircuitBreakerError extends AppError {
  public readonly statusCode = 503;
  public readonly errorCode = 'CIRCUIT_BREAKER_OPEN';
}

export class ExternalServiceError extends AppError {
  public readonly statusCode = 502;
  public readonly errorCode = 'EXTERNAL_SERVICE_ERROR';
}

export class RateLimitError extends AppError {
  public readonly statusCode = 429;
  public readonly errorCode = 'RATE_LIMIT_EXCEEDED';
}

export class UnauthorizedError extends AppError {
  public readonly statusCode = 401;
  public readonly errorCode = 'UNAUTHORIZED';
}

export class ForbiddenError extends AppError {
  public readonly statusCode = 403;
  public readonly errorCode = 'FORBIDDEN';
}

export class InsufficientCreditsError extends AppError {
  public readonly statusCode = 402;
  public readonly errorCode = 'INSUFFICIENT_CREDITS';
}

