import type { OsacMessage } from '../clients/osac-client';
import { osacConnector } from '../connectors/osac-connector';
import { osacConnectionManager } from './osac-connection-manager';
import { auditOsacAction } from '../utils/osac-audit';

type OpencodePartInput = {
  type: string;
  text?: string;
  mime?: string;
  url?: string;
  name?: string;
};

export class OsacAgentService {
  private fallbackStreams = new Map<string, { sessionId: string; stop: () => void }>();

  private buildFallbackStreamKey(sessionId: string, requestId: string): string {
    const normalizedRequestId = requestId || `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    return `${sessionId}::${normalizedRequestId}`;
  }

  private stopFallbackStreamsForSession(sessionId: string) {
    for (const [key, value] of this.fallbackStreams.entries()) {
      if (value.sessionId !== sessionId) continue;
      this.fallbackStreams.delete(key);
      try {
        value.stop();
      } catch {
        // ignore stop errors
      }
    }
  }

  async executeCommand(
    sessionId: string,
    input: {
      command: string;
      sessionId?: string;
      continueSession?: boolean;
      options?: Record<string, unknown>;
    }
  ) {
    const message: OsacMessage = {
      type: 'EXECUTE_COMMAND',
      payload: {
        command: input.command,
        sessionId: input.sessionId,
        continueSession: input.continueSession,
        options: input.options || {},
      },
    };

    auditOsacAction('EXECUTE_COMMAND', { sessionId, command: input.command });

    await osacConnectionManager.send(sessionId, message);
    return { status: 'sent' };
  }

  async executeCommandAndWait(
    sessionId: string,
    input: {
      command: string;
      sessionId?: string;
      continueSession?: boolean;
      options?: Record<string, unknown>;
    },
    config?: { timeoutMs?: number; pollMs?: number }
  ) {
    const startCount = osacConnectionManager.getMessageCount(sessionId);
    await this.executeCommand(sessionId, input);

    const timeoutMs = config?.timeoutMs ?? Number(process.env.OSAC_COMMAND_TIMEOUT_MS || 900000);
    const pollMs = config?.pollMs ?? Number(process.env.OSAC_COMMAND_POLL_MS || 2000);
    const idleMs = Number(process.env.OSAC_COMMAND_IDLE_MS || 60000);

    const startAt = Date.now();
    let lastOutputAt = Date.now();
    let lastMessageCount = startCount;
    let status: string | null = null;
    while (Date.now() - startAt < timeoutMs) {
      const newMessages = osacConnectionManager.getMessagesSince(sessionId, lastMessageCount);
      if (newMessages.length > 0) {
        lastMessageCount += newMessages.length;
        const hasOutput = newMessages.some((msg) => msg.type === 'COMMAND_OUTPUT');
        if (hasOutput) {
          lastOutputAt = Date.now();
        }
      }
      const messages = osacConnectionManager.getMessagesSince(sessionId, startCount);
      const statusMessage = [...messages].reverse().find((msg) => msg.type === 'COMMAND_STATUS');
      if (statusMessage) {
        const payload = statusMessage.payload || {};
        status = String(payload.status || payload.state || '');
        if (status && status !== 'running') {
          break;
        }
      }
      if (status === 'running' && Date.now() - lastOutputAt > idleMs) {
        status = 'running_timeout';
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }

    const messages = osacConnectionManager.getMessagesSince(sessionId, startCount);
    const outputs = messages
      .filter((msg) => msg.type === 'COMMAND_OUTPUT')
      .map((msg) => {
        const payload = msg.payload || {};
        return (
          payload.output ||
          payload.content ||
          payload.text ||
          payload.data ||
          ''
        );
      })
      .filter(Boolean)
      .join('\n');

    return {
      status: status || 'unknown',
      output: outputs,
      messages,
    };
  }

  async getSessionList(sessionId: string, input?: { maxCount?: number; format?: string }) {
    const message: OsacMessage = {
      type: 'GET_SESSION_LIST',
      payload: {
        maxCount: input?.maxCount,
        format: input?.format,
      },
    };

    auditOsacAction('GET_SESSION_LIST', { sessionId });

    const reply = await osacConnectionManager.request(sessionId, message, (res) => {
      return res.type === 'SESSION_LIST_RESPONSE';
    });

    return reply.payload || {};
  }

  async getSessionDetails(sessionId: string, opencodeSessionId: string) {
    const message: OsacMessage = {
      type: 'GET_SESSION_DETAILS',
      payload: {
        sessionId: opencodeSessionId,
      },
    };

    auditOsacAction('GET_SESSION_DETAILS', { sessionId, opencodeSessionId });

    const reply = await osacConnectionManager.request(sessionId, message, (res) => {
      return res.type === 'SESSION_DETAILS_RESPONSE';
    });

    return reply.payload || {};
  }

  async loadSkill(sessionId: string, input: { skillName: string; skillContent: string; overwrite?: boolean }) {
    const message: OsacMessage = {
      type: 'LOAD_SKILL',
      payload: {
        skillName: input.skillName,
        skillContent: input.skillContent,
        overwrite: input.overwrite ?? false,
      },
    };

    auditOsacAction('LOAD_SKILL', { sessionId, skillName: input.skillName });

    const reply = await osacConnectionManager.request(sessionId, message, (res) => {
      return res.type === 'SKILL_STATUS' && res.payload?.skillName === input.skillName;
    });

    return reply.payload || {};
  }

  async unloadSkill(sessionId: string, skillName: string) {
    const message: OsacMessage = {
      type: 'UNLOAD_SKILL',
      payload: {
        skillName,
      },
    };

    auditOsacAction('UNLOAD_SKILL', { sessionId, skillName });

    const reply = await osacConnectionManager.request(sessionId, message, (res) => {
      return res.type === 'SKILL_STATUS' && res.payload?.skillName === skillName;
    });

    return reply.payload || {};
  }

  async addMcpServer(
    sessionId: string,
    input: { serverName: string; serverConfig: Record<string, unknown>; overwrite?: boolean }
  ) {
    const message: OsacMessage = {
      type: 'ADD_MCP_SERVER',
      payload: {
        serverName: input.serverName,
        serverConfig: input.serverConfig,
        overwrite: input.overwrite ?? false,
      },
    };

    auditOsacAction('ADD_MCP_SERVER', { sessionId, serverName: input.serverName });

    const reply = await osacConnectionManager.request(sessionId, message, (res) => {
      return res.type === 'MCP_SERVER_STATUS' && res.payload?.serverName === input.serverName;
    });

    return reply.payload || {};
  }

  async removeMcpServer(sessionId: string, serverName: string) {
    const message: OsacMessage = {
      type: 'REMOVE_MCP_SERVER',
      payload: {
        serverName,
      },
    };

    auditOsacAction('REMOVE_MCP_SERVER', { sessionId, serverName });

    const reply = await osacConnectionManager.request(sessionId, message, (res) => {
      return res.type === 'MCP_SERVER_STATUS' && res.payload?.serverName === serverName;
    });

    return reply.payload || {};
  }

  async initiateUpdate(
    sessionId: string,
    input: { updateType: string; version?: string; downloadUrl?: string; updateCommand?: string }
  ) {
    const message: OsacMessage = {
      type: 'INITIATE_UPDATE',
      payload: {
        updateType: input.updateType,
        version: input.version,
        downloadUrl: input.downloadUrl,
        updateCommand: input.updateCommand,
      },
    };

    auditOsacAction('INITIATE_UPDATE', { sessionId, updateType: input.updateType });

    await osacConnectionManager.send(sessionId, message);
    return { status: 'sent' };
  }

  private async opencodeRequest(
    sessionId: string,
    message: OsacMessage,
    expectedType: string,
    options?: { streamEvents?: boolean }
  ): Promise<Record<string, unknown>> {
    const payload = (message.payload || {}) as Record<string, unknown>;
    const requestId = String(message.requestId || payload.requestId || '').trim();

    let reply: OsacMessage | null = null;
    try {
      reply = await osacConnectionManager.request(
        sessionId,
        message,
        this.matchOpencodeReply(expectedType, requestId)
      );
    } catch (error) {
      if (!this.shouldUseBootstrapFallback(error)) {
        throw error;
      }
      auditOsacAction('OPENCODE_BOOTSTRAP_FALLBACK', {
        sessionId,
        messageType: message.type,
        expectedType,
        requestId: requestId || null,
      });
      await osacConnectionManager.close(sessionId);
      const maxAttempts = Math.max(1, Number(process.env.OSAC_BOOTSTRAP_CONNECT_ATTEMPTS || 4));
      const delayMs = Math.max(500, Number(process.env.OSAC_BOOTSTRAP_CONNECT_DELAY_MS || 2500));
      let fallbackError: unknown = null;
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          reply = await this.opencodeRequestViaBootstrap(sessionId, message, expectedType, {
            requestId,
            streamEvents: options?.streamEvents === true,
          });
          fallbackError = null;
          break;
        } catch (fallbackAttemptError) {
          fallbackError = fallbackAttemptError;
          if (!this.isMappingStaleError(fallbackAttemptError) || attempt >= maxAttempts) {
            break;
          }
          await this.sleep(delayMs);
        }
      }
      if (fallbackError) {
        throw fallbackError;
      }
    }

    if (!reply) {
      throw new Error('OSAC OpenCode 请求未返回响应');
    }

    if (reply.type === 'OPENCODE_ERROR') {
      const payload = (reply.payload || {}) as Record<string, unknown>;
      const messageText = String(payload.message || payload.code || 'opencode remote error');
      throw new Error(messageText);
    }

    return (reply.payload || {}) as Record<string, unknown>;
  }

  private matchOpencodeReply(expectedType: string, requestId: string) {
    return (res: OsacMessage) => {
      if (res.type !== expectedType && res.type !== 'OPENCODE_ERROR') {
        return false;
      }
      if (!requestId) {
        return true;
      }
      return this.matchRequestId(res, requestId);
    };
  }

  private matchRequestId(message: OsacMessage, requestId: string): boolean {
    if (!requestId) return true;
    const payload = (message.payload || {}) as Record<string, unknown>;
    const replyRequestId = String(message.requestId || payload.requestId || '').trim();
    return replyRequestId === requestId;
  }

  private shouldUseBootstrapFallback(error: unknown): boolean {
    if (!this.bootstrapFallbackEnabled()) {
      return false;
    }
    const text = error instanceof Error ? error.message : String(error);
    return text.includes('OSAC 请求超时') || /request timeout/i.test(text);
  }

  private isMappingStaleError(error: unknown): boolean {
    const text = error instanceof Error ? error.message : String(error);
    return text.includes('code=mapping_stale') || /mapping_stale/i.test(text);
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private bootstrapFallbackEnabled(): boolean {
    const raw = String(process.env.OSAC_OPENCODE_BOOTSTRAP_FALLBACK || 'true').trim().toLowerCase();
    return raw !== 'false';
  }

  private asString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  private toRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  }

  private detectTerminalOutcome(message: OsacMessage): 'completed' | 'failed' | null {
    if (message.type === 'OPENCODE_ERROR') {
      return 'failed';
    }
    if (message.type !== 'OPENCODE_EVENT') {
      return null;
    }

    const payload = this.toRecord(message.payload);
    const event = this.toRecord(payload.event);
    const properties = this.toRecord(event.properties);
    const info = this.toRecord(properties.info);
    const eventType = this.asString(payload.eventType) || this.asString(event.type);

    const states = [
      this.asString(payload.state),
      this.asString(payload.status),
      this.asString(event.state),
      this.asString(event.status),
      this.asString(properties.state),
      this.asString(properties.status),
      this.asString(info.state),
      this.asString(info.status),
    ]
      .map((state) => state.toLowerCase())
      .filter(Boolean);

    const failStates = new Set(['failed', 'error', 'cancelled', 'canceled', 'aborted', 'timeout']);
    const doneStates = new Set(['completed', 'done', 'finished', 'success', 'succeeded', 'idle']);

    if (states.some((state) => failStates.has(state))) return 'failed';
    if (states.some((state) => doneStates.has(state))) return 'completed';

    const lowerType = eventType.toLowerCase();
    if (/(^|[._-])(failed|error|cancelled|canceled|aborted|timeout)([._-]|$)/.test(lowerType)) {
      return 'failed';
    }
    if (/(^|[._-])(completed|finished|done|succeeded|success|idle)([._-]|$)/.test(lowerType)) {
      return 'completed';
    }

    if (
      event.final === true ||
      event.done === true ||
      event.isFinal === true ||
      properties.final === true ||
      properties.done === true ||
      properties.isFinal === true
    ) {
      return 'completed';
    }

    return null;
  }

  private async opencodeRequestViaBootstrap(
    sessionId: string,
    message: OsacMessage,
    expectedType: string,
    options?: { requestId?: string; streamEvents?: boolean }
  ): Promise<OsacMessage> {
    const requestId = String(options?.requestId || '').trim();
    const streamEvents = options?.streamEvents === true;
    const responseTimeoutRaw =
      message.type === 'OPENCODE_PROMPT_SEND'
        ? Number(process.env.OSAC_BOOTSTRAP_PROMPT_TIMEOUT_MS || 180000)
        : Number(process.env.OSAC_BOOTSTRAP_REQUEST_TIMEOUT_MS || process.env.OSAC_REQUEST_TIMEOUT_MS || 45000);
    const responseTimeoutMs = Math.max(
      2000,
      Number.isFinite(responseTimeoutRaw) && responseTimeoutRaw > 0 ? responseTimeoutRaw : 45000
    );
    const eventIdleMs = Math.max(5000, Number(process.env.OSAC_BOOTSTRAP_EVENT_IDLE_MS || 120000));
    const eventMaxMs = Math.max(10000, Number(process.env.OSAC_BOOTSTRAP_EVENT_MAX_MS || 900000));
    const streamKey = this.buildFallbackStreamKey(sessionId, requestId);

    const handle = await osacConnector.connectForSession(sessionId, { bootstrapMessage: message });

    let responseSettled = false;
    let streamStarted = false;
    let idleTimer: NodeJS.Timeout | null = null;
    let maxTimer: NodeJS.Timeout | null = null;
    let responseTimer: NodeJS.Timeout | null = null;

    const clearTimers = () => {
      if (responseTimer) {
        clearTimeout(responseTimer);
        responseTimer = null;
      }
      if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = null;
      }
      if (maxTimer) {
        clearTimeout(maxTimer);
        maxTimer = null;
      }
    };

    const closeHandle = () => {
      try {
        handle.close();
      } catch {
        // ignore close errors
      }
    };

    const stopStreaming = (reason: string) => {
      this.fallbackStreams.delete(streamKey);
      if (streamStarted) {
        auditOsacAction('OPENCODE_BOOTSTRAP_STREAM_STOP', { sessionId, reason });
      }
      clearTimers();
      closeHandle();
    };

    const armIdleTimer = () => {
      if (!streamStarted) return;
      if (idleTimer) {
        clearTimeout(idleTimer);
      }
      idleTimer = setTimeout(() => {
        stopStreaming('idle_timeout');
      }, eventIdleMs);
      if (typeof idleTimer.unref === 'function') {
        idleTimer.unref();
      }
    };

    const startStreaming = () => {
      if (!streamEvents || streamStarted) return;
      streamStarted = true;
      auditOsacAction('OPENCODE_BOOTSTRAP_STREAM_START', { sessionId, requestId: requestId || null });
      armIdleTimer();
      maxTimer = setTimeout(() => {
        stopStreaming('max_timeout');
      }, eventMaxMs);
      if (typeof maxTimer.unref === 'function') {
        maxTimer.unref();
      }

      const previous = this.fallbackStreams.get(streamKey);
      if (previous) {
        previous.stop();
      }
      this.fallbackStreams.set(streamKey, { sessionId, stop: streamStopper });
    };

    const streamStopper = () => {
      stopStreaming('manual_stop');
    };

    const response = await new Promise<OsacMessage>((resolve, reject) => {
      const settle = (fn: () => void) => {
        if (responseSettled) return;
        responseSettled = true;
        if (responseTimer) {
          clearTimeout(responseTimer);
          responseTimer = null;
        }
        fn();
      };

      responseTimer = setTimeout(() => {
        settle(() => {
          clearTimers();
          closeHandle();
          reject(new Error('OSAC 请求超时（bootstrap fallback）'));
        });
      }, responseTimeoutMs);
      if (responseTimer && typeof responseTimer.unref === 'function') {
        responseTimer.unref();
      }

      handle.onClose(() => {
        if (!responseSettled) {
          settle(() => reject(new Error('OSAC bootstrap 通道在收到响应前已关闭')));
          return;
        }
        if (streamStarted) {
          this.fallbackStreams.delete(streamKey);
        }
        clearTimers();
      });

      handle.onMessage((reply) => {
        osacConnectionManager.emitExternalMessage(sessionId, reply);

        if (!responseSettled && this.matchOpencodeReply(expectedType, requestId)(reply)) {
          settle(() => {
            if (streamEvents && reply.type === expectedType) {
              startStreaming();
            } else {
              clearTimers();
              closeHandle();
            }
            resolve(reply);
          });
          return;
        }

        if (!streamStarted) {
          return;
        }
        armIdleTimer();
        const terminal = this.detectTerminalOutcome(reply);
        if (terminal) {
          stopStreaming(`terminal_${terminal}`);
        }
      });
    });

    return response;
  }

  async ensureOpencodeServer(
    sessionId: string,
    input?: { host?: string; port?: number; workspacePath?: string }
  ) {
    const requestId = `oc_ensure_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const message: OsacMessage = {
      type: 'OPENCODE_SERVER_ENSURE',
      requestId,
      payload: {
        requestId,
        host: input?.host,
        port: input?.port,
        workspacePath: input?.workspacePath,
      },
    };

    auditOsacAction('OPENCODE_SERVER_ENSURE', { sessionId, workspacePath: input?.workspacePath || null });

    return await this.opencodeRequest(sessionId, message, 'OPENCODE_SERVER_READY');
  }

  async createOpencodeSession(
    sessionId: string,
    input?: { workspacePath?: string; title?: string }
  ) {
    const requestId = `oc_create_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const message: OsacMessage = {
      type: 'OPENCODE_SESSION_CREATE',
      requestId,
      payload: {
        requestId,
        workspacePath: input?.workspacePath,
        title: input?.title,
      },
    };

    auditOsacAction('OPENCODE_SESSION_CREATE', { sessionId, workspacePath: input?.workspacePath || null });

    return await this.opencodeRequest(sessionId, message, 'OPENCODE_SESSION_READY');
  }

  async sendOpencodePrompt(
    sessionId: string,
    input: { opencodeSessionId: string; parts: OpencodePartInput[]; workspacePath?: string }
  ) {
    const requestId = `oc_prompt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const message: OsacMessage = {
      type: 'OPENCODE_PROMPT_SEND',
      requestId,
      payload: {
        requestId,
        workspacePath: input.workspacePath,
        opencodeSessionId: input.opencodeSessionId,
        parts: input.parts || [],
      },
    };

    auditOsacAction('OPENCODE_PROMPT_SEND', {
      sessionId,
      opencodeSessionId: input.opencodeSessionId,
      partsCount: input.parts?.length || 0,
    });

    return await this.opencodeRequest(sessionId, message, 'OPENCODE_PROMPT_ACCEPTED', {
      streamEvents: true,
    });
  }

  listMessages(sessionId: string, limit?: number) {
    return osacConnectionManager.listMessages(sessionId, limit);
  }

  async closeConnection(sessionId: string) {
    this.stopFallbackStreamsForSession(sessionId);
    await osacConnectionManager.close(sessionId);
  }
}

export const osacAgentService = new OsacAgentService();
