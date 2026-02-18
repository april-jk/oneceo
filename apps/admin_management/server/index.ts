import cors from 'cors';
import express from 'express';
import { config } from './config';
import { kvmOrchestratorConnector } from './connectors/kvm-orchestrator-connector';
import { createAuditRoutes } from './routes/audit-routes';
import { createDashboardRoutes } from './routes/dashboard-routes';
import { createHostRoutes } from './routes/host-routes';
import { createKvmRoutes } from './routes/kvm-routes';
import { AuditService } from './services/audit-service';
import { DashboardService } from './services/dashboard-service';
import { KvmService } from './services/kvm-service';
import { errorMiddleware, fail } from './utils/http';

const app = express();

const auditService = new AuditService();
const kvmService = new KvmService(kvmOrchestratorConnector, auditService);
const dashboardService = new DashboardService(kvmOrchestratorConnector, auditService);

app.use(
  cors({
    origin: config.corsOrigin,
  })
);
app.use(express.json({ limit: '2mb' }));

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'admin-management-api',
    timestamp: new Date().toISOString(),
  });
});

app.use('/api/kvm', createKvmRoutes(kvmService));
app.use('/api/hosts', createHostRoutes(kvmOrchestratorConnector));
app.use('/api/dashboard', createDashboardRoutes(dashboardService));
app.use('/api/audit', createAuditRoutes(auditService));

app.use((req, res) => {
  return fail(res, 404, `Route ${req.method} ${req.path} not found`);
});

app.use(errorMiddleware);

app.listen(config.port, () => {
  console.log('');
  console.log('Admin Management API');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`API: http://localhost:${config.port}`);
  console.log(`Health: http://localhost:${config.port}/health`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
});
