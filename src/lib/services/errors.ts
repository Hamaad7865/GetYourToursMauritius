/**
 * Framework-agnostic error taxonomy for the service layer.
 *
 * Services throw these; the HTTP bridge (src/lib/http) maps `status` and `code`
 * onto a consistent JSON error envelope. No Next.js / Response coupling here so
 * the same services run unchanged in a mobile/Node context.
 */
export type ServiceErrorCode =
  | 'validation_error'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'booking_not_payable'
  | 'rate_limited'
  | 'config_error'
  | 'provider_error'
  | 'not_implemented'
  | 'internal_error';

export class ServiceError extends Error {
  readonly code: ServiceErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ServiceErrorCode, message: string, status: number, details?: unknown) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export class ValidationError extends ServiceError {
  constructor(message = 'Validation failed', details?: unknown) {
    super('validation_error', message, 400, details);
  }
}

export class UnauthorizedError extends ServiceError {
  constructor(message = 'Authentication required') {
    super('unauthorized', message, 401);
  }
}

export class ForbiddenError extends ServiceError {
  constructor(message = 'Not allowed') {
    super('forbidden', message, 403);
  }
}

export class NotFoundError extends ServiceError {
  constructor(message = 'Resource not found') {
    super('not_found', message, 404);
  }
}

export class ConflictError extends ServiceError {
  constructor(message = 'Conflict', details?: unknown) {
    super('conflict', message, 409, details);
  }
}

/**
 * A booking is already paid or in a terminal state (expired/cancelled/refunded), so a payment cannot
 * be (re)created for it. Distinct 409 code so the checkout client can clear its stale stashed ref and
 * prompt a fresh booking, instead of walking a returning customer into a second charge.
 */
export class BookingNotPayableError extends ServiceError {
  constructor(message = 'This booking is already paid or is no longer payable') {
    super('booking_not_payable', message, 409);
  }
}

export class RateLimitError extends ServiceError {
  constructor(message = 'Too many requests — please try again later') {
    super('rate_limited', message, 429);
  }
}

export class ConfigError extends ServiceError {
  constructor(message = 'Service is not configured', details?: unknown) {
    super('config_error', message, 500, details);
  }
}

export class ProviderError extends ServiceError {
  constructor(message = 'Upstream provider error', details?: unknown) {
    super('provider_error', message, 502, details);
  }
}

export class NotImplementedError extends ServiceError {
  constructor(what = 'This operation') {
    super('not_implemented', `${what} is not implemented yet`, 501);
  }
}

export function isServiceError(error: unknown): error is ServiceError {
  return error instanceof ServiceError;
}
