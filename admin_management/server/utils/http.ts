import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { AppError } from './errors';

export function ok<T>(res: Response, data: T) {
  return res.json({
    success: true,
    data,
  });
}

export function fail(res: Response, statusCode: number, message: string, details?: unknown) {
  return res.status(statusCode).json({
    success: false,
    error: {
      message,
      details,
    },
  });
}

export function asyncHandler(handler: RequestHandler): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      await handler(req, res, next);
    } catch (error) {
      next(error);
    }
  };
}

export function errorMiddleware(error: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (error instanceof AppError) {
    return fail(res, error.statusCode, error.message, error.details);
  }

  if (error && typeof error === 'object' && 'name' in error && (error as any).name === 'ZodError') {
    const issue = (error as any).issues?.[0];
    return fail(res, 400, '请求参数不合法', {
      path: issue?.path,
      message: issue?.message,
    });
  }

  console.error('[admin-management] unhandled error', error);
  return fail(res, 500, '服务器内部错误');
}