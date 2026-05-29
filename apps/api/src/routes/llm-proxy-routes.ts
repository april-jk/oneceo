import express from 'express';
import { llmProxyConnector } from '../connectors/llm-proxy-connector';
import { getPublicErrorMessage } from '../utils/error-response';

const router = express.Router();

function isTrustedLoopbackRequest(req: express.Request): boolean {
  const address = String(req.socket?.remoteAddress || req.ip || '').trim();
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

// OpenAI-compatible proxy routes (raw body)
router.all('/v1/*', async (req, res) => {
  if (!isTrustedLoopbackRequest(req)) {
    res.status(403).json({
      error: {
        message: getPublicErrorMessage('LLM proxy only accepts internal loopback requests'),
        type: 'forbidden',
        code: 'forbidden',
      },
    });
    return;
  }
  await llmProxyConnector.forward(req, res);
});

export default router;
