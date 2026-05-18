import cors from 'cors';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, isAllowedCorsOrigin } from './config';
import { kvmOrchestratorConnector } from './connectors/kvm-orchestrator-connector';
import { oneceoApiConnector } from './connectors/oneceo-api-connector';
import { createAdminAuthRoutes } from './routes/admin-auth-routes';
import { createAdminThemeRoutes } from './routes/admin-theme-routes';
import { createConversationRoutes } from './routes/conversation-routes';
import { createDeploymentManagementRoutes } from './routes/deployment-management-routes';
import { createConnectorGuideRoutes } from './routes/connector-guide-routes';
import { createDashboardRoutes } from './routes/dashboard-routes';
import { createHostRoutes } from './routes/host-routes';
import { createKvmRoutes } from './routes/kvm-routes';
import { createSandboxManagementRoutes } from './routes/sandbox-management-routes';
import { createSkillManagementRoutes } from './routes/skill-management-routes';
import { createOsacReleaseRoutes } from './routes/osac-release-routes';
import { createOperationsAnalyticsRoutes } from './routes/operations-analytics-routes';
import { createUserManagementRoutes } from './routes/user-management-routes';
import { createBillingManagementRoutes } from './routes/billing-management-routes';
import { createNotificationManagementRoutes } from './routes/notification-management-routes';
import { createMembershipManagementRoutes } from './routes/membership-management-routes';
import { createPromoBannerManagementRoutes } from './routes/promo-banner-management-routes';
import { AdminThemeService } from './services/admin-theme-service';
import { ConversationManagementService } from './services/conversation-management-service';
import { DeploymentManagementService } from './services/deployment-management-service';
import { ConnectorGuideManagementService } from './services/connector-guide-management-service';
import { DashboardService } from './services/dashboard-service';
import { HostRuntimeService } from './services/host-runtime-service';
import { KvmService } from './services/kvm-service';
import { SandboxManagementService } from './services/sandbox-management-service';
import { SkillManagementService } from './services/skill-management-service';
import { OsacReleaseManagementService } from './services/osac-release-management-service';
import { OperationsAnalyticsService } from './services/operations-analytics-service';
import { UserManagementService } from './services/user-management-service';
import { errorMiddleware, fail } from './utils/http';
import { createAdminAuthMiddleware } from './middleware/admin-auth-middleware';

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const adminWebDistPath = path.resolve(__dirname, '..', 'web', 'dist');
const adminWebIndexPath = path.resolve(adminWebDistPath, 'index.html');
const hasBuiltAdminWeb = fs.existsSync(adminWebIndexPath);
const jsonBodyLimitMbRaw = Number(process.env.ADMIN_JSON_BODY_LIMIT_MB || 16);
const jsonBodyLimitMb = Number.isFinite(jsonBodyLimitMbRaw)
  ? Math.min(64, Math.max(1, Math.floor(jsonBodyLimitMbRaw)))
  : 16;
const jsonBodyLimit = `${jsonBodyLimitMb}mb`;

const adminThemeService = new AdminThemeService();
const kvmService = new KvmService(kvmOrchestratorConnector);
const dashboardService = new DashboardService(kvmOrchestratorConnector);
const hostRuntimeService = new HostRuntimeService(kvmOrchestratorConnector);
const conversationService = new ConversationManagementService(oneceoApiConnector, kvmOrchestratorConnector);
const deploymentManagementService = new DeploymentManagementService(oneceoApiConnector);
const sandboxManagementService = new SandboxManagementService();
const skillManagementService = new SkillManagementService(oneceoApiConnector);
const connectorGuideManagementService = new ConnectorGuideManagementService(oneceoApiConnector);
const osacReleaseManagementService = new OsacReleaseManagementService(oneceoApiConnector);
const operationsAnalyticsService = new OperationsAnalyticsService(oneceoApiConnector);
const userManagementService = new UserManagementService(oneceoApiConnector);

app.use(express.json({ limit: jsonBodyLimit }));
if (hasBuiltAdminWeb) {
  app.use(express.static(adminWebDistPath));
}
app.use(
  '/api',
  cors({
    origin(origin, callback) {
      if (isAllowedCorsOrigin(origin)) {
        callback(null, true);
        return;
      }
      // Disallow CORS without turning request into 500. Browser will block cross-origin calls.
      callback(null, false);
    },
    credentials: true,
  })
);

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

app.use('/api/admin/auth', createAdminAuthRoutes(oneceoApiConnector));

// 轻量代理：智能体健康检查（无需认证，供运营概览使用）
app.get('/api/agents/health', async (_req, res) => {
  try {
    const data = await oneceoApiConnector.getAgentHealth();
    res.json(data);
  } catch (error) {
    res.status(502).json({ success: false, message: error instanceof Error ? error.message : '智能体接口不可用' });
  }
});

app.use('/api', createAdminAuthMiddleware(oneceoApiConnector));
app.use('/api/kvm', createKvmRoutes(kvmService));
app.use('/api/hosts', createHostRoutes(hostRuntimeService));
app.use('/api/dashboard', createDashboardRoutes(dashboardService));
app.use('/api/conversations', createConversationRoutes(conversationService));
app.use('/api/deployment-management', createDeploymentManagementRoutes(deploymentManagementService));
app.use('/api/theme', createAdminThemeRoutes(adminThemeService));
app.use('/api/sandbox-management', createSandboxManagementRoutes(sandboxManagementService));
app.use('/api/user-management', createUserManagementRoutes(userManagementService));
app.use('/api/skill-management', createSkillManagementRoutes(skillManagementService));
app.use('/api/connector-guides', createConnectorGuideRoutes(connectorGuideManagementService));
app.use('/api/osac-releases', createOsacReleaseRoutes(osacReleaseManagementService));
app.use('/api/operations-analytics', createOperationsAnalyticsRoutes(operationsAnalyticsService));
app.use('/api/internal/billing', createBillingManagementRoutes());
app.use('/api/internal/notifications', createNotificationManagementRoutes());
app.use('/api/internal/promo-banners', createPromoBannerManagementRoutes());
app.use('/api/internal/membership', createMembershipManagementRoutes());

if (hasBuiltAdminWeb) {
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path === '/health') {
      next();
      return;
    }
    res.sendFile(adminWebIndexPath);
  });
}

app.use((req, res) => {
  return fail(res, 404, `Route ${req.method} ${req.path} not found`);
});

app.use(errorMiddleware);

app.listen(config.port, config.host, () => {
  console.log('');
  console.log('Admin Management API');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`API: http://${config.host}:${config.port}`);
  console.log(`Health: http://${config.host}:${config.port}/health`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
});
