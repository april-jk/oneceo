import express from 'express';
import { llmProxyConnector } from '../connectors/llm-proxy-connector';

const router = express.Router();

// OpenAI-compatible proxy routes (raw body)
router.all('/v1/*', async (req, res) => {
  await llmProxyConnector.forward(req, res);
});

export default router;
