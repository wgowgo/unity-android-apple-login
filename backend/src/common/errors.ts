import { HttpException } from '@nestjs/common';

export const ErrorCode = {
  INVALID_REQUEST: 'INVALID_REQUEST',
  INVALID_STATE: 'INVALID_STATE',
  INVALID_NONCE: 'INVALID_NONCE',
  INVALID_TICKET: 'INVALID_TICKET',
  TICKET_EXPIRED: 'TICKET_EXPIRED',
  VERIFIER_MISMATCH: 'VERIFIER_MISMATCH',
  APPLE_ERROR: 'APPLE_ERROR',
  TOKEN_EXCHANGE_FAILED: 'TOKEN_EXCHANGE_FAILED',
  ID_TOKEN_INVALID: 'ID_TOKEN_INVALID',
  ACCOUNT_CONFLICT: 'ACCOUNT_CONFLICT',
  UNAUTHORIZED: 'UNAUTHORIZED',
  SESSION_REUSE: 'SESSION_REUSE',
  ALREADY_LINKED: 'ALREADY_LINKED',
  NOT_LINKED: 'NOT_LINKED',
  REAUTH_REQUIRED: 'REAUTH_REQUIRED',
  RATE_LIMITED: 'RATE_LIMITED',
  LOGIN_IN_PROGRESS: 'LOGIN_IN_PROGRESS',
  SUBJECT_MISMATCH: 'SUBJECT_MISMATCH',
} as const;

export type ErrorCodeName = (typeof ErrorCode)[keyof typeof ErrorCode];

export class AuthException extends HttpException {
  constructor(
    public readonly code: ErrorCodeName,
    message: string,
    status = 400,
  ) {
    super({ statusCode: status, code, message }, status);
  }
}
