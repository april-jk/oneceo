import cors from 'cors';
import express from 'express';
import { config } from './config';
import { kvmOrchestratorConnector } from './connectors/kvm-orchestrator-connector';
import { oneceoApiConnector } from './connectors/oneceo-api-connector';
import { createAgentManagementRoutes } from './routes/agent-management-routes';
import { createAuditRoutes } from './routes/audit-routes';
import { createConversationRoutes } from './routes/conversation-routes';
import { createDashboardRoutes } from './routes/dashboard-routes';
import { createHostRoutes } from './routes/host-routes';
import { createKvmRoutes } from './routes/kvm-routes';
import { createSandboxManagementRoutes } from './routes/sandbox-management-routes';
import { createSkillManagementRoutes } from './routes/skill-management-routes';
import { AgentManagementService } from './services/agent-management-service';
import { AuditService } from './services/audit-service';
import { ConversationManagementService } from './services/conversation-management-service';
import { DashboardService } from './services/dashboard-service';
import { HostRuntimeService } from './services/host-runtime-service';
import { KvmService } from './services/kvm-service';
import { SandboxManagementService } from './services/sandbox-management-service';
import { SkillManagementService } from './services/skill-management-service';
import { errorMiddleware, fail } from './utils/http';

const app = express();
const jsonBodyLimitMbRaw = Number(process.env.ADMIN_JSON_BODY_LIMIT_MB || 16);
const jsonBodyLimitMb = Number.isFinite(jsonBodyLimitMbRaw)
  ? Math.min(64, Math.max(1, Math.floor(jsonBodyLimitMbRaw)))
  : 16;
const jsonBodyLimit = `${jsonBodyLimitMb}mb`;

const auditService = new AuditService();
const kvmService = new KvmService(kvmOrchestratorConnector, auditService);
const dashboardService = new DashboardService(kvmOrchestratorConnector, auditService);
const hostRuntimeService = new HostRuntimeService(kvmOrchestratorConnector);
const conversationService = new ConversationManagementService(oneceoApiConnector, kvmOrchestratorConnector, auditService);
const agentManagementService = new AgentManagementService(oneceoApiConnector);
const sandboxManagementService = new SandboxManagementService();
const skillManagementService = new SkillManagementService(oneceoApiConnector);

app.use(
  cors({
    origin: config.corsOrigin,
  })
);
app.use(express.json({ limit: jsonBodyLimit }));

app.use((req, res, next) => {
  const startedAt = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - startedAt;
    console.log(
      '[admin-management][request]',
      JSON.stringify({
        method: req.method,
        path: req.originalUrl || req.url,
        status: res.statusCode,
        durationMs: duration,
      })
    );
  });
  next();
});

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'admin-management-api',
    timestamp: new Date().toISOString(),
  });
});

app.use('/api/kvm', createKvmRoutes(kvmService));
app.use('/api/hosts', createHostRoutes(hostRuntimeService));
app.use('/api/dashboard', createDashboardRoutes(dashboardService));
app.use('/api/audit', createAuditRoutes(auditService));
app.use('/api/conversations', createConversationRoutes(conversationService));
app.use('/api/agent-management', createAgentManagementRoutes(agentManagementService));
app.use('/api/sandbox-management', createSandboxManagementRoutes(sandboxManagementService));
app.use('/api/skill-management', createSkillManagementRoutes(skillManagementService));

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
