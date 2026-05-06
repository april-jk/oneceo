import './config/env';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import type { WebSocketEvent } from '@oneceo/shared';
import agentRoutes from './routes/agent-routes';
import taskCreationRoutes from './routes/task-creation-routes';
import altusManagedRoutes from './routes/altus-managed-routes';
import sandboxRoutes from './routes/sandbox-routes';
import osacRoutes from './routes/osac-routes';
import llmProxyRoutes from './routes/llm-proxy-routes';
import connectorRoutes from './routes/connector-routes';
import authRoutes from './routes/auth-routes';
import authOauthRoutes from './routes/auth-oauth-routes';
import internalSkillRoutes from './routes/internal-skill-routes';
import internalSandboxRoutes from './routes/internal-sandbox-routes';
import internalConnectorGuideRoutes from './routes/internal-connector-guide-routes';
import internalCustomApiRoutes from './routes/internal-custom-api-routes';
import internalRuntimeArtifactRoutes from './routes/internal-runtime-artifact-routes';
import internalAdminAuthRoutes from './routes/internal-admin-auth-routes';
import internalAdminAppUserRoutes from './routes/internal-admin-app-user-routes';
import internalAdminDeploymentRoutes from './routes/internal-admin-deployment-routes';
import internalAdminOperationsAnalyticsRoutes from './routes/internal-admin-operations-analytics-routes';
import internalTaskCreationRoutes from './routes/internal-task-creation-routes';
import internalMembershipRoutes from './routes/internal-membership-routes';
import billingRoutes from './routes/billing-routes';
import internalBillingRoutes from './routes/internal-billing-routes';
import activationCodeRoutes from './routes/activation-code-routes';
import notificationRoutes from './routes/notification-routes';
import internalNotificationRoutes from './routes/internal-notification-routes';
import internalPromoBannerRoutes from './routes/internal-promo-banner-routes';
import uiPromoBannerRoutes from './routes/ui-promo-banner-routes';
import internalTraceRoutes from './routes/trace-routes';
import { taskCreationWebSocketService } from './agents/task-creation/websocket-service';
import { closeDatabaseConnection, testDatabaseConnection } from './config/database';
import { getPublicErrorMessage } from './utils/error-response';
import { osacLlmProxyBridgeService } from './services/osac-llm-proxy-bridge';
import { hostedProviderHostService } from './services/hosted-provider-host-service';
import { osacPersistentRecoveryService } from './services/osac-persistent-recovery-service';
import { sessionMcpRecoveryService } from './services/session-mcp-recovery-service';
import { startSandboxArchiveJob, stopSandboxArchiveJob } from './services/sandbox-archive-job';
import { startMembershipDailyRestoreJob, stopMembershipDailyRestoreJob } from './services/membership-daily-restore-job';
import { startApiTraceCleanupJob, stopApiTraceCleanupJob } from './services/api-trace-cleanup-job';
import { startApiRequestLogCleanupJob, stopApiRequestLogCleanupJob } from './services/api-request-log-cleanup-job';
import { requestLogMiddleware } from './middleware/request-log-middleware';
import {
  startTaskSessionDeploymentSyncJob,
  stopTaskSessionDeploymentSyncJob,
} from './services/task-session-deployment-runtime-service';
import { connectorStorageBootstrap } from './services/connector-storage-bootstrap';
import { connectorGuideService } from './services/connector-guide-service';
import { isConnectorGuideStartupRecomputeEnabled } from './services/connector-guide-startup-config';
import { appAuthMiddleware } from './middleware/app-auth-middleware';
import { adminAuthService } from './services/admin-auth-service';
import { getProxyEnv, isGlobalProxyEnabled } from './config/proxy';

function mergeNoProxy(entries: string[], current?: string): string {
  const normalized = (current || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const set = new Set(normalized);
  for (const entry of entries) {
    if (entry) set.add(entry);
  }
  return Array.from(set).join(',');
}

const { httpProxy, httpsProxy } = getProxyEnv();
const proxyEnabled =
  isGlobalProxyEnabled() &&
  (Boolean(httpProxy) || Boolean(httpsProxy));

if (proxyEnabled) {
  const bypass = [
    '127.0.0.1',
    'localhost',
    '::1',
    '.e2b.app',
    'api.e2b.dev',
    'e2b.dev',
  ];
  const merged = mergeNoProxy(bypass, process.env.NO_PROXY || process.env.no_proxy);
  process.env.NO_PROXY = merged;
  process.env.no_proxy = merged;
}

const app = express();
const httpServer = createServer(app);
const llmProxyBodyLimitMbRaw = Number(process.env.LLM_PROXY_BODY_LIMIT_MB || 64);
const llmProxyBodyLimitMb = Number.isFinite(llmProxyBodyLimitMbRaw)
  ? Math.min(128, Math.max(1, Math.floor(llmProxyBodyLimitMbRaw)))
  : 64;
const llmProxyBodyLimit = `${llmProxyBodyLimitMb}mb`;
const jsonBodyLimitMbRaw = Number(process.env.API_JSON_BODY_LIMIT_MB || 16);
const jsonBodyLimitMb = Number.isFinite(jsonBodyLimitMbRaw)
  ? Math.min(64, Math.max(1, Math.floor(jsonBodyLimitMbRaw)))
  : 16;
const jsonBodyLimit = `${jsonBodyLimitMb}mb`;
const connectorGuideStartupRecomputeEnabled = isConnectorGuideStartupRecomputeEnabled();
const io = new Server(httpServer, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  },
});

// ============================================================================
// 中间件
// ============================================================================

const allowedOrigins = String(process.env.FRONTEND_URL || 'http://localhost:3000')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    credentials: true,
  })
);
// LLM proxy uses raw body for streaming compatibility
app.use('/api/llm-proxy', express.raw({ type: '*/*', limit: llmProxyBodyLimit }));
app.use(express.json({ limit: jsonBodyLimit }));
app.use(appAuthMiddleware);
app.use(requestLogMiddleware);

// 请求日志（控制台）
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ============================================================================
// 健康检查
// ============================================================================

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  });
});

// ============================================================================
// API 路由
// ============================================================================

// 项目相关 API
app.get('/api/projects', (req, res) => {
  res.json({
    success: true,
    data: [],
    message: 'Projects API - Coming soon',
  });
});

app.post('/api/projects', (req, res) => {
  res.json({
    success: true,
    data: { id: 'temp-id' },
    message: 'Project created - Coming soon',
  });
});

// 任务创建相关 API
app.use('/api/auth', authRoutes);
app.use('/api/auth', authOauthRoutes);
app.use('/api/task-creation', taskCreationRoutes);
app.use('/api/altus-managed', altusManagedRoutes);
app.use('/api/sandbox', sandboxRoutes);
app.use('/api/sandbox/osac', osacRoutes);
app.use('/api/llm-proxy', llmProxyRoutes);
app.use('/api/connectors', connectorRoutes);
app.use('/api/internal', internalSkillRoutes);
app.use('/api/internal', internalSandboxRoutes);
app.use('/api/internal', internalConnectorGuideRoutes);
app.use('/api/internal', internalCustomApiRoutes);
app.use('/api/internal', internalRuntimeArtifactRoutes);
app.use('/api/internal', internalAdminAuthRoutes);
app.use('/api/internal', internalAdminAppUserRoutes);
app.use('/api/internal', internalAdminDeploymentRoutes);
app.use('/api/internal/admin/operations/analytics', internalAdminOperationsAnalyticsRoutes);
app.use('/api/internal', internalTaskCreationRoutes);
app.use('/api/internal', internalMembershipRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/internal/billing', internalBillingRoutes);
app.use('/api/activation-codes', activationCodeRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/internal/notifications', internalNotificationRoutes);
app.use('/api/internal/promo-banners', internalPromoBannerRoutes);
app.use('/api/ui/promo-banners', uiPromoBannerRoutes);
app.use('/api/internal', internalTraceRoutes);

// 任务相关 API
app.get('/api/tasks', (req, res) => {
  res.json({
    success: true,
    data: [],
    message: 'Tasks API - Coming soon',
  });
});

// 消息相关 API
app.post('/api/messages', (req, res) => {
  res.json({
    success: true,
    data: { id: 'temp-id' },
    message: 'Message sent - Coming soon',
  });
});

// Agent 相关 API
app.use('/api/agents', agentRoutes);

// ============================================================================
// WebSocket 连接
// ============================================================================

io.on('connection', (socket) => {
  console.log('✅ Client connected:', socket.id);

  // 用户发送消息
  socket.on('user:message', async (data: { message: string; conversationId: string }) => {
    console.log('📨 User message:', data);

    // 确认收到消息
    const event: WebSocketEvent = {
      type: 'message:received',
      data: { id: `msg-${Date.now()}` },
    };
    socket.emit('message:received', event.data);

    // 模拟 Agent 思考
    setTimeout(() => {
      const thinkingEvent: WebSocketEvent = {
        type: 'agent:thinking',
        data: { agentId: 'ceo-001', message: '正在分析您的需求...' },
      };
      socket.emit('agent:thinking', thinkingEvent.data);
    }, 500);

    // 模拟 Agent 响应
    setTimeout(() => {
      const responseEvent: WebSocketEvent = {
        type: 'agent:response',
        data: {
          agentId: 'ceo-001',
          response: '我已经收到您的消息。这是一个演示响应，实际的 AI Agent 功能正在开发中。',
        },
      };
      socket.emit('agent:response', responseEvent.data);
    }, 2000);
  });

  // 断开连接
  socket.on('disconnect', () => {
    console.log('❌ Client disconnected:', socket.id);
  });
});

// ============================================================================
// 错误处理
// ============================================================================

app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: getPublicErrorMessage('服务异常，请稍后重试'),
    },
  });
});

// ============================================================================
// 启动服务器
// ============================================================================

const PORT = process.env.PORT || 4000;
const API_HOST = (process.env.API_HOST || '::').trim() || '::';
const API_HOST_DISPLAY = API_HOST.includes(':') ? `[${API_HOST}]` : API_HOST;
let shuttingDown = false;
let isListening = false;
let listenRetryTimer: NodeJS.Timeout | null = null;
let listenAttempts = 0;
const maxListenRetries = Math.max(0, Number(process.env.API_PORT_RETRY_ATTEMPTS || 12));
const listenRetryDelayMs = Math.max(100, Number(process.env.API_PORT_RETRY_DELAY_MS || 500));

function isRecoverableSocketProcessError(error: unknown): boolean {
  const record = error as { code?: unknown; message?: unknown; syscall?: unknown } | null;
  const code = typeof record?.code === 'string' ? record.code.toUpperCase() : '';
  const syscall = typeof record?.syscall === 'string' ? record.syscall.toLowerCase() : '';
  const message = error instanceof Error ? error.message.toLowerCase() : String(error || '').toLowerCase();
  return (
    code === 'EPIPE' ||
    code === 'ECONNRESET' ||
    (syscall === 'write' && message.includes('epipe')) ||
    message.includes('socket hang up')
  );
}

async function shutdown(signal: string, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`[API] shutdown start: ${signal}`);

  try {
    if (listenRetryTimer) {
      clearTimeout(listenRetryTimer);
      listenRetryTimer = null;
    }
    stopSandboxArchiveJob();
    stopMembershipDailyRestoreJob();
    stopTaskSessionDeploymentSyncJob();
    stopApiTraceCleanupJob();
    stopApiRequestLogCleanupJob();
  } catch (error) {
    console.warn('[API] stop background jobs failed:', error);
  }

  try {
    io.close();
  } catch (error) {
    console.warn('[API] socket.io close failed:', error);
  }

  try {
    taskCreationWebSocketService.close();
  } catch (error) {
    console.warn('[API] taskCreationWebSocketService.close failed:', error);
  }

  await new Promise<void>((resolve) => {
    try {
      if (isListening) {
        httpServer.close(() => resolve());
      } else {
        resolve();
      }
    } catch (_error) {
      resolve();
    }
  });

  try {
    await closeDatabaseConnection();
  } catch (error) {
    console.warn('[API] closeDatabaseConnection failed:', error);
  }

  process.exit(exitCode);
}

adminAuthService.ensureBootstrapAdmin().catch((error) => {
  console.error('[ADMIN_AUTH_BOOTSTRAP_FAILED]', error);
});

httpServer.on('error', (error: any) => {
  if (error?.code === 'EADDRINUSE' && !isListening && !shuttingDown) {
    if (listenAttempts < maxListenRetries) {
      listenAttempts += 1;
      console.warn(
        `[API] Port ${PORT} is temporarily in use. Retry ${listenAttempts}/${maxListenRetries} in ${listenRetryDelayMs}ms.`
      );
      if (listenRetryTimer) {
        clearTimeout(listenRetryTimer);
      }
      listenRetryTimer = setTimeout(() => {
        listenRetryTimer = null;
        if (!shuttingDown && !isListening) {
          httpServer.listen(Number(PORT), API_HOST);
        }
      }, listenRetryDelayMs);
      return;
    }
    console.error(
      `[API] Port ${PORT} is already in use. Another api dev process may still be running.`
    );
    void shutdown('httpServer:error', 1);
    return;
  }
  console.error('[API] httpServer error:', error);
  void shutdown('httpServer:error', 1);
});

// 初始化任务创建 WebSocket 服务
taskCreationWebSocketService.initialize(httpServer);
osacLlmProxyBridgeService.initialize();
hostedProviderHostService.initialize();

async function startServer() {
  await connectorStorageBootstrap.ensureReady();
  await connectorGuideService.ensureBuiltinPolicies();

  httpServer.listen(Number(PORT), API_HOST, () => {
    isListening = true;
    listenAttempts = 0;
    console.log('');
    console.log('🚀 oneceo.ai API Server');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`📡 API server running on http://${API_HOST_DISPLAY}:${PORT}`);
    console.log(`🔌 WebSocket server running on ws://${API_HOST_DISPLAY}:${PORT}`);
    console.log(`🔌 Task Creation WebSocket: ws://${API_HOST_DISPLAY}:${PORT}/ws/task-creation`);
    console.log(`🏥 Health check: http://${API_HOST_DISPLAY}:${PORT}/health`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    // 启动后先进行数据库连通性重试检测
    void testDatabaseConnection({ retries: 5, delayMs: 1500 });
    // API 重启后恢复最近 ready session 的持久 OSAC 桥接连接
    void osacPersistentRecoveryService.recoverReadySessions();
    // API 重启后恢复积压的 session MCP reconcile 任务
    void sessionMcpRecoveryService
      .recoverBacklog()
      .catch((error) => console.error('[SESSION_MCP_RECOVERY_BACKLOG_FAILED]', error));
    if (connectorGuideStartupRecomputeEnabled) {
      void connectorGuideService
        .recomputeBuiltinPolicySessions()
        .catch((error) => console.error('[CONNECTOR_GUIDE_BACKGROUND_RECOMPUTE_FAILED]', error));
    } else {
      console.log('[CONNECTOR_GUIDE_STARTUP_RECOMPUTE_SKIPPED] set CONNECTOR_GUIDE_STARTUP_RECOMPUTE_ENABLED=true to enable');
    }
    // 启动 Sandbox 空闲归档任务
    startSandboxArchiveJob();
    // 启动会员每日自动恢复积分任务
    startMembershipDailyRestoreJob();
    // 启动部署状态后台同步任务
    startTaskSessionDeploymentSyncJob();
    // 启动 API 追踪数据清理任务
    startApiTraceCleanupJob();
    startApiRequestLogCleanupJob();
    
    console.log('');
  });
}

void startServer().catch((error) => {
  console.error('[API] startup failed before listen:', error);
  process.exit(1);
});

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

process.on('uncaughtException', (error) => {
  if (isRecoverableSocketProcessError(error)) {
    console.warn('[API_RECOVERABLE_SOCKET_ERROR]', error);
    return;
  }
  console.error('[API_UNCAUGHT_EXCEPTION]', error);
  void shutdown('uncaughtException', 1);
});

process.on('unhandledRejection', (reason) => {
  if (isRecoverableSocketProcessError(reason)) {
    console.warn('[API_RECOVERABLE_SOCKET_REJECTION]', reason);
    return;
  }
  console.error('[API_UNHANDLED_REJECTION]', reason);
  void shutdown('unhandledRejection', 1);
});
