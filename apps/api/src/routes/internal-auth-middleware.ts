import express from 'express';
import { getPublicErrorMessage } from '../utils/error-response';

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

export function createRequireInternalToken(options?: {
  disabledMessage?: string;
  unauthorizedMessage?: string;
}) {
  const disabledMessage = options?.disabledMessage || '内部接口未启用';
  const unauthorizedMessage = options?.unauthorizedMessage || '未授权的内部请求';

  return function requireInternalToken(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) {
    const configured = asText(process.env.ONECEO_INTERNAL_TOKEN);
    if (!configured) {
      res.status(403).json({
        success: false,
        error: getPublicErrorMessage(disabledMessage),
      });
      return;
    }

    const incoming = asText(req.header('x-oneceo-internal-token'));
    if (incoming !== configured) {
      res.status(401).json({
        success: false,
        error: getPublicErrorMessage(unauthorizedMessage),
      });
      return;
    }

    next();
  };
}
