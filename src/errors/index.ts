export class AppError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super('VALIDATION_ERROR', message);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string) {
    super('NOT_FOUND', message);
  }
}

type ConflictCode = 'INSUFFICIENT_AVAILABILITY' | 'RESERVATION_EXPIRED' | 'INVALID_STATE';

export class ConflictError extends AppError {
  constructor(code: ConflictCode, message: string) {
    super(code, message);
  }
}
