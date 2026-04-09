import type { RequestHandler } from 'express';

export function mockAuthContextMiddleware(headerName = 'x-test-user-id'): RequestHandler {
  const normalizedHeaderName = String(headerName || 'x-test-user-id').trim().toLowerCase();
  return (req, _res, next) => {
    const userId = String(req.header(normalizedHeaderName) || '').trim();
    if (userId) {
      (req as any).user = {
        id: userId,
        userId,
      };
      (req as any).auth = {
        userId,
      };
      (req as any).currentAppUser = {
        id: userId,
      };
    }
    next();
  };
}
