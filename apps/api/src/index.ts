import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import dotenv from 'dotenv';
import type { WebSocketEvent } from '@oneceo/shared';
import agentRoutes from './routes/agent-routes';
import taskCreationRoutes from './routes/task-creation-routes';
import sandboxRoutes from './routes/sandbox-routes';
import { taskCreationWebSocketService } from './agents/task-creation/websocket-service';
import { testDatabaseConnection } from './config/database';
import { getPublicErrorMessage } from './utils/error-response';

dotenv.config();

const app = express();
const httpServer = createServer(app);
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
app.use(express.json());

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
app.use('/api/sandbox', sandboxRoutes);

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

// 初始化任务创建 WebSocket 服务
taskCreationWebSocketService.initialize(httpServer);

httpServer.listen(PORT, () => {
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
  
  console.log('');
});
