import type { Response } from 'express';
import type { ApiEnvelope } from '../types';

export function ok<T>(res: Response, data: T) {
  const body: ApiEnvelope<T> = {
    code: 0,
    message: 'success',
    data,
  };
  return res.json(body);
}

export function fail(
  res: Response,
  code: number,
  message: string,
  error?: { type: string; details?: string; field?: string }
) {
  const body: ApiEnvelope<never> = {
    code,
    message,
    ...(error ? { error } : {}),
  };
  return res.status(code).json(body);
}

export class ApiError extends Error {
  readonly status: number;
  readonly type: string;
  readonly field?: string;

  constructor(status: number, type: string, message: string, field?: string) {
    super(message);
    this.status = status;
    this.type = type;
    this.field = field;
  }
}
