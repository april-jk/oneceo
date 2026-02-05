import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import kvmRoutes from './routes/kvm-routes';
import sessionRoutes from './routes/session-routes';
import quotaRoutes from './routes/quota-routes';
import { ApiError, fail } from './utils/response';

dotenv.config();

const app = express();
const PORT = Number(process.env.KVM_ORCHESTRATOR_PORT || 8500);

app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'kvm-orchestrator',
    timestamp: new Date().toISOString(),
  });
});

app.use('/api/v1/kvm', kvmRoutes);
app.use('/api/v1/session', sessionRoutes);
app.use('/api/v1/quota', quotaRoutes);

app.use((req, res) => {
  return fail(res, 404, 'Not Found', {
    type: 'NOT_FOUND',
    details: `Route ${req.method} ${req.path} not found`,
  });
});

app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof ApiError) {
    return fail(res, error.status, error.message, {
      type: error.type,
      details: error.message,
      field: error.field,
    });
  }

  if (error?.name === 'ZodError') {
    const issue = error.issues?.[0];
    return fail(res, 400, 'Bad Request', {
      type: 'INVALID_PARAMETER',
      details: issue?.message || 'Invalid request body',
      field: issue?.path?.join('.') || undefined,
    });
  }

  console.error('[kvm-orchestrator] unhandled error:', error);
  return fail(res, 500, 'Internal Error', {
    type: 'INTERNAL_ERROR',
    details: 'Unexpected server error',
  });
});

app.listen(PORT, () => {
  console.log('');
  console.log('KVM Orchestrator Service');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`API: http://localhost:${PORT}`);
  console.log(`Health: http://localhost:${PORT}/health`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
});
