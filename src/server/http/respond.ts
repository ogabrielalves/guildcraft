import type { Response } from 'express';
import type { ErrorCode } from '../../shared/errors.js';

const STATUS: Partial<Record<ErrorCode, number>> = {
  UNAUTHORIZED: 401,
  AGENT_NOT_FOUND: 404,
  AGENT_OFFLINE: 409,
  QUEUE_FULL: 429,
};

export function statusFor(code: ErrorCode): number {
  return STATUS[code] ?? 400;
}

export function sendError(res: Response, code: ErrorCode): void {
  res.status(statusFor(code)).json({ code });
}
