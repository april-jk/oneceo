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
import internalSkillRoutes from './routes/internal-skill-routes';
import { taskCreationWebSocketService } from './agents/task-creation/websocket-service';
import { closeDatabaseConnection, testDatabaseConnection } from './config/database';
import { getPublicErrorMessage } from './utils/error-response';
import { osacLlmProxyBridgeService } from './services/osac-llm-proxy-bridge';
import { osacPersistentRecoveryService } from './services/osac-persistent-recovery-service';
import { startSandboxArchiveJob, stopSandboxArchiveJob } from './services/sandbox-archive-job';
import { connectorStorageBootstrap } from './services/connector-storage-bootstrap';

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

const proxyToggleRaw = String(process.env.E2B_PROXY_ENABLED ?? process.env.ONECEO_PROXY_ENABLED ?? 'true')
  .trim()
  .toLowerCase();
const proxyToggleEnabled = !['0', 'false', 'no', 'off'].includes(proxyToggleRaw);
const proxyEnabled =
  proxyToggleEnabled &&
  (Boolean(process.env.HTTP_PROXY || process.env.http_proxy) ||
    Boolean(process.env.HTTPS_PROXY || process.env.https_proxy));

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
const io = new Server(httpServer, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  },
});

// ============================================================================
// 中间件
// ============================================================================

app.use(cors());
// LLM proxy uses raw body for streaming compatibility
app.use('/api/llm-proxy', express.raw({ type: '*/*', limit: llmProxyBodyLimit }));
app.use(express.json({ limit: jsonBodyLimit }));

// 请求日志
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
app.use('/api/task-creation', taskCreationRoutes);
app.use('/api/altus-managed', altusManagedRoutes);
app.use('/api/sandbox', sandboxRoutes);
app.use('/api/sandbox/osac', osacRoutes);
app.use('/api/llm-proxy', llmProxyRoutes);
app.use('/api/connectors', connectorRoutes);
app.use('/api/internal', internalSkillRoutes);

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
let shuttingDown = false;
let isListening = false;
let listenRetryTimer: NodeJS.Timeout | null = null;
let listenAttempts = 0;
const maxListenRetries = Math.max(0, Number(process.env.API_PORT_RETRY_ATTEMPTS || 12));
const listenRetryDelayMs = Math.max(100, Number(process.env.API_PORT_RETRY_DELAY_MS || 500));

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
  } catch (error) {
    console.warn('[API] stopSandboxArchiveJob failed:', error);
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
          httpServer.listen(PORT);
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

async function startServer() {
  await connectorStorageBootstrap.ensureReady();

  httpServer.listen(PORT, () => {
    isListening = true;
    listenAttempts = 0;
    console.log('');
    console.log('🚀 oneceo.ai API Server');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`📡 API server running on http://localhost:${PORT}`);
    console.log(`🔌 WebSocket server running on ws://localhost:${PORT}`);
    console.log(`🔌 Task Creation WebSocket: ws://localhost:${PORT}/ws/task-creation`);
    console.log(`🏥 Health check: http://localhost:${PORT}/health`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    // 启动后先进行数据库连通性重试检测
    void testDatabaseConnection({ retries: 5, delayMs: 1500 });
    // API 重启后恢复最近 ready session 的持久 OSAC 桥接连接
    void osacPersistentRecoveryService.recoverReadySessions();
    // 启动 Sandbox 空闲归档任务
    startSandboxArchiveJob();
    
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
