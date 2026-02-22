/**
 * 任务创建智能体 Hook
 * 
 * 管理与任务创建 WebSocket 的连接和消息交互
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useLocation } from 'wouter';
import {
  createTaskCreationSocket,
  listOsacMessages,
  listTaskCreationMessages,
  type TaskCreationHistoryMessage,
  type OsacMessageRecord,
} from '@/lib/task-creation-client';

export interface AgentMessage {
  type:
    | 'agent_message'
    | 'status_update'
    | 'clarification_request'
    | 'plan_generated'
    | 'error'
    | 'user_input'
    | 'user_response'
    | 'opencode_event';
  sessionId?: string;
  content?: string;
  agent?: string;
  stage?: 'collecting' | 'clarifying' | 'planning' | 'executing' | 'reviewing' | 'completed' | 'failed';
  tone?: 'system' | 'intent' | 'planning' | 'execution' | 'review' | 'error';
  metadata?: any;
  question?: string;
  options?: string[];
  plan?: any;
  message?: string;
}

export interface OrchestrationRuntime {
  orchestratorSessionId: string | null;
  latestType: string | null;
  latestText: string | null;
  syncing: boolean;
  error: string | null;
  messages: OsacMessageRecord[];
  refresh: () => Promise<void>;
}

export interface UseTaskCreationAgentOptions {
  onPlanGenerated?: (plan: any) => void;
  onError?: (error: string) => void;
}

function extractOrchestratorSessionId(message: AgentMessage): string | null {
  const candidate = message?.metadata?.orchestratorSessionId;
  return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : null;
}

function pickOsacMessageText(message: OsacMessageRecord | null): string | null {
  const payload = (message?.payload || {}) as Record<string, unknown>;
  const candidates = [
    payload.output,
    payload.content,
    payload.message,
    payload.text,
    payload.error,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }

  return null;
}

function parseStructString(value: string): Record<string, unknown> {
  const text = value.trim();
  if (!text.startsWith('@{') || !text.endsWith('}')) {
    return {};
  }
  const body = text.slice(2, -1);
  const result: Record<string, unknown> = {};
  for (const rawPart of body.split(';')) {
    const part = rawPart.trim();
    if (!part) continue;
    const eqIndex = part.indexOf('=');
    if (eqIndex <= 0) {
      result[part] = true;
      continue;
    }
    const key = part.slice(0, eqIndex).trim();
    const val = part.slice(eqIndex + 1).trim();
    if (!key) continue;
    result[key] = val;
  }
  return result;
}

function toRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object') return value as Record<string, unknown>;
  if (typeof value === 'string') {
    const parsed = parseStructString(value);
    if (Object.keys(parsed).length > 0) return parsed;
  }
  return {};
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

type OpencodeEventInfo = {
  eventType: string;
  event: Record<string, unknown>;
  properties: Record<string, unknown>;
  part: Record<string, unknown>;
  partType: string;
  partId: string;
  toolName: string;
};

function getOpencodeEventInfo(metadata: Record<string, unknown>): OpencodeEventInfo {
  const rawPayload = toRecord(metadata.rawPayload);
  const eventFromMeta = toRecord(metadata.event);
  const eventFromPayload = toRecord(rawPayload.event);
  const event = Object.keys(eventFromMeta).length > 0 ? eventFromMeta : eventFromPayload;
  const eventType = asText(metadata.eventType) || asText(event.type);
  const properties = toRecord(event.properties);
  const part = toRecord(properties.part);
  const partType = (asText(part.type) || asText(properties.type)).toLowerCase();
  const toolName = asText(part.tool) || asText(part.name) || asText(properties.tool);
  const partId = asText(part.id) || asText(part.callID) || asText(properties.partId);
  return {
    eventType,
    event,
    properties,
    part,
    partType,
    partId,
    toolName,
  };
}

function resolveStreamKeyFromMetadata(metadata: Record<string, unknown>): string | null {
  const explicit = asText(metadata.streamKey);
  if (explicit) return explicit;

  const { eventType, partId } = getOpencodeEventInfo(metadata);
  const opencodeSessionId = asText(metadata.opencodeSessionId);
  if (opencodeSessionId && partId) {
    return `${opencodeSessionId}:${partId}`;
  }
  if (opencodeSessionId && eventType) {
    return `${opencodeSessionId}:${eventType}`;
  }
  return null;
}

function isTextStreamEvent(metadata: Record<string, unknown>, content?: string): boolean {
  const text = (content || '').trim();
  if (metadata.stream === true) {
    const { partType } = getOpencodeEventInfo(metadata);
    if (partType && partType !== 'text') {
      return false;
    }
    const normalized = text.replace(/\s+/g, ' ');
    const blockedPhrases = [
      '你是执行智能体',
      '用户需求',
      '任务描述',
      '执行计划摘要',
      '要求：',
      '要求:',
    ];
    if (blockedPhrases.some((phrase) => normalized.includes(phrase))) {
      return false;
    }
    return true;
  }

  const { eventType, partType } = getOpencodeEventInfo(metadata);
  if (eventType !== 'message.part.updated' && eventType !== 'message.part.delta') {
    return false;
  }

  if (partType === 'text') {
    return true;
  }

  if (!text) {
    return false;
  }
  if (/^\[(OpenCode|Tool|File|Command|PTY|Message)\]/.test(text)) {
    return false;
  }
  return true;
}

function isNonTextPartEvent(metadata: Record<string, unknown>): boolean {
  const { eventType, partType, toolName } = getOpencodeEventInfo(metadata);
  if (eventType !== 'message.part.updated' && eventType !== 'message.part.delta') {
    return false;
  }
  if (!partType || partType !== 'tool') return false;
  if (toolName.toLowerCase() === 'todoread') return false;
  return true;
}

function shouldDisplayOpencodeEvent(metadata: Record<string, unknown>, content?: string): boolean {
  const { eventType, partType, toolName } = getOpencodeEventInfo(metadata);
  const text = (content || '').trim();

  if (metadata.stream === true) {
    return isTextStreamEvent(metadata, content);
  }

  if (eventType === 'message.final') {
    return true;
  }

  if (
    (eventType === 'message.part.updated' || eventType === 'message.part.delta') &&
    partType === 'tool' &&
    toolName.toLowerCase() !== 'todoread'
  ) {
    return true;
  }

  if (text.startsWith('[Tool]')) {
    return true;
  }

  if (
    eventType.startsWith('file.') ||
    eventType.startsWith('pty.') ||
    eventType === 'command.executed' ||
    eventType === 'session.diff'
  ) {
    return true;
  }

  return false;
}

function isTerminalOpencodeMessage(message: AgentMessage): boolean {
  const metadata = toRecord(message.metadata);
  const outcome = asText(metadata.outcome).toLowerCase();
  if (outcome === 'completed' || outcome === 'failed') {
    return true;
  }

  const content = (message.content || message.message || '').trim();
  if (!content) {
    return false;
  }
  return content.includes('OpenCode 执行完成') || content.includes('OpenCode 执行失败');
}

function mergeRealtimeMessage(
  prev: AgentMessage[],
  message: AgentMessage,
  welcomeMessage: string
): AgentMessage[] {
  const lastMessage = prev[prev.length - 1];
  const isDuplicateWelcome =
    message.type === 'agent_message' &&
    message.agent === 'system' &&
    message.content === welcomeMessage &&
    lastMessage?.type === 'agent_message' &&
    lastMessage?.agent === 'system' &&
    lastMessage?.content === welcomeMessage;
  if (isDuplicateWelcome) {
    return prev;
  }

  const metadata = toRecord(message.metadata);
  if (message.type === 'opencode_event' && !shouldDisplayOpencodeEvent(metadata, message.content)) {
    return prev;
  }
  if (message.type === 'opencode_event' && isNonTextPartEvent(metadata)) {
    const streamKey = resolveStreamKeyFromMetadata(metadata);
    if (!streamKey) {
      return [...prev, message];
    }

    const idx = prev.findIndex((item) => {
      if (item.type !== 'opencode_event') return false;
      const itemMeta = toRecord(item.metadata);
      if (!isNonTextPartEvent(itemMeta)) return false;
      return resolveStreamKeyFromMetadata(itemMeta) === streamKey;
    });

    if (idx >= 0) {
      const next = [...prev];
      next[idx] = {
        ...next[idx],
        ...message,
        metadata: {
          ...toRecord(next[idx].metadata),
          ...metadata,
        },
      };
      return next;
    }

    return [...prev, message];
  }
  if (message.type === 'opencode_event' && isTextStreamEvent(metadata, message.content)) {
    const streamKey = resolveStreamKeyFromMetadata(metadata);
    if (!streamKey) {
      return [...prev, message];
    }

    const idx = prev.findIndex((item) => {
      if (item.type !== 'opencode_event') return false;
      const itemMeta = toRecord(item.metadata);
      if (!isTextStreamEvent(itemMeta, item.content)) return false;
      return resolveStreamKeyFromMetadata(itemMeta) === streamKey;
    });

    if (idx >= 0) {
      const next = [...prev];
      next[idx] = {
        ...next[idx],
        ...message,
        metadata: {
          ...toRecord(next[idx].metadata),
          ...metadata,
        },
      };
      return next;
    }

    return [...prev, message];
  }

  if (message.type === 'opencode_event' && asText(metadata.eventType) === 'message.final') {
    const filtered = prev.filter((item) => {
      if (item.type !== 'opencode_event') return true;
      const itemMeta = toRecord(item.metadata);
      return !isTextStreamEvent(itemMeta, item.content);
    });
    return [...filtered, message];
  }

  if ((message.type === 'status_update' || message.type === 'error') && isTerminalOpencodeMessage(message)) {
    const filtered = prev.filter((item) => {
      if (item.type !== 'opencode_event') return true;
      const itemMeta = toRecord(item.metadata);
      return !isTextStreamEvent(itemMeta, item.content);
    });
    return [...filtered, message];
  }

  return [...prev, message];
}

function compactHistoryMessages(list: TaskCreationHistoryMessage[]): TaskCreationHistoryMessage[] {
  const result: TaskCreationHistoryMessage[] = [];
  const streamIndexByKey = new Map<string, number>();

  for (const item of list) {
    const messageType = asText(item?.messageType);
    const metadata = toRecord(item?.metadata);

    if (messageType === 'opencode_event' && asText(metadata.eventType) === 'message.final') {
      const filtered = result.filter((existing) => {
        if (asText(existing?.messageType) !== 'opencode_event') return true;
        return !isTextStreamEvent(toRecord(existing?.metadata), existing?.content);
      });
      result.length = 0;
      result.push(...filtered, item);
      streamIndexByKey.clear();
      continue;
    }

    if (messageType === 'opencode_event' && !shouldDisplayOpencodeEvent(metadata, item?.content)) {
      continue;
    }

    if (messageType === 'opencode_event' && isNonTextPartEvent(metadata)) {
      const streamKey = resolveStreamKeyFromMetadata(metadata);
      if (!streamKey) {
        result.push(item);
        continue;
      }

      const existingIndex = streamIndexByKey.get(streamKey);
      if (existingIndex !== undefined) {
        result[existingIndex] = item;
      } else {
        streamIndexByKey.set(streamKey, result.length);
        result.push(item);
      }
      continue;
    }

    if (messageType === 'opencode_event' && isTextStreamEvent(metadata, item?.content)) {
      const streamKey = resolveStreamKeyFromMetadata(metadata);
      if (!streamKey) {
        result.push(item);
        continue;
      }

      const existingIndex = streamIndexByKey.get(streamKey);
      if (existingIndex !== undefined) {
        result[existingIndex] = item;
      } else {
        streamIndexByKey.set(streamKey, result.length);
        result.push(item);
      }
      continue;
    }

    if (messageType === 'opencode_status') {
      const content = asText(item?.content);
      if (content.includes('OpenCode 执行完成') || content.includes('OpenCode 执行失败')) {
        const filtered = result.filter((existing) => {
          if (asText(existing?.messageType) !== 'opencode_event') return true;
          return !isTextStreamEvent(toRecord(existing?.metadata), existing?.content);
        });
        result.length = 0;
        result.push(...filtered);
      }
      streamIndexByKey.clear();
    }

    result.push(item);
  }

  return result;
}

export function useTaskCreationAgent(options?: UseTaskCreationAgentOptions) {
  const SESSION_STORAGE_KEY = 'task_creation_session_id';
  const WELCOME_MESSAGE = '欢迎使用 Altus 任务创建助手！请描述您想要创建的任务。';
  const [isConnected, setIsConnected] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [currentQuestion, setCurrentQuestion] = useState<{
    question: string;
    options?: string[];
  } | null>(null);
  const [orchestratorSessionId, setOrchestratorSessionId] = useState<string | null>(null);
  const [latestOsacMessage, setLatestOsacMessage] = useState<OsacMessageRecord | null>(null);
  const [runtimeMessages, setRuntimeMessages] = useState<OsacMessageRecord[]>([]);
  const [isSyncingRuntime, setIsSyncingRuntime] = useState(false);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [location] = useLocation();

  const wsRef = useRef<WebSocket | null>(null);
  const onPlanGeneratedRef = useRef(options?.onPlanGenerated);
  const onErrorRef = useRef(options?.onError);

  const resetConversationState = useCallback((nextSessionId: string | null = null) => {
    setMessages([]);
    setCurrentQuestion(null);
    setOrchestratorSessionId(null);
    setLatestOsacMessage(null);
    setRuntimeMessages([]);
    setRuntimeError(null);
    setSessionId(nextSessionId);
    if (nextSessionId) {
      window.localStorage.setItem(SESSION_STORAGE_KEY, nextSessionId);
    } else {
      window.localStorage.removeItem(SESSION_STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const querySessionId = params.get('sessionId')?.trim();
    const createNewToken = params.get('new')?.trim();

    if (createNewToken) {
      if (sessionId !== null || messages.length > 0) {
        resetConversationState(null);
      }
      return;
    }

    if (querySessionId) {
      if (querySessionId !== sessionId) {
        resetConversationState(querySessionId);
      }
      return;
    }
  }, [location, sessionId, messages.length, resetConversationState]);

  useEffect(() => {
    onPlanGeneratedRef.current = options?.onPlanGenerated;
    onErrorRef.current = options?.onError;
  }, [options?.onPlanGenerated, options?.onError]);

  // 连接 WebSocket
  const connect = useCallback(() => {
    if (
      wsRef.current?.readyState === WebSocket.OPEN ||
      wsRef.current?.readyState === WebSocket.CONNECTING
    ) {
      return;
    }

    const ws = createTaskCreationSocket();

    ws.onopen = () => {
      console.log('[TaskCreationAgent] WebSocket 连接成功');
      setIsConnected(true);
    };

    ws.onmessage = (event) => {
      try {
        const message: AgentMessage = JSON.parse(event.data);
        console.log('[TaskCreationAgent] 收到消息:', message);
        const messageSessionId = message.sessionId || message.metadata?.sessionId;
        if (messageSessionId) {
          setSessionId(messageSessionId);
          window.localStorage.setItem(SESSION_STORAGE_KEY, messageSessionId);
          const params = new URLSearchParams(window.location.search);
          const currentInQuery = params.get('sessionId')?.trim();
          if (currentInQuery !== messageSessionId || params.get('new')) {
            params.set('sessionId', messageSessionId);
            params.delete('new');
            const query = params.toString();
            window.history.replaceState(null, '', query ? `/new-task?${query}` : '/new-task');
          }
        }
        const orchestratorId = extractOrchestratorSessionId(message);
        if (orchestratorId) {
          setOrchestratorSessionId(orchestratorId);
        }

        setMessages((prev) => mergeRealtimeMessage(prev, message, WELCOME_MESSAGE));

        switch (message.type) {
          case 'agent_message':
          case 'status_update':
            if (message.type === 'status_update' && (message.stage === 'completed' || message.stage === 'failed')) {
              setIsProcessing(false);
            }
            // 显示 Agent 消息
            break;

          case 'clarification_request':
            // 显示澄清问题
            setIsProcessing(false);
            if (message.question) {
              setCurrentQuestion({
                question: message.question,
                options: message.options,
              });
            }
            break;

          case 'plan_generated':
            // 计划生成完成
            setIsProcessing(false);
            if (message.plan && onPlanGeneratedRef.current) {
              onPlanGeneratedRef.current(message.plan);
            }
            break;

          case 'opencode_event':
            // OpenCode 运行时事件，直接进入消息流展示
            break;

          case 'error':
            // 错误处理
            setIsProcessing(false);
            if (message.message && onErrorRef.current) {
              onErrorRef.current(message.message);
            }
            break;

        }
      } catch (error) {
        console.error('[TaskCreationAgent] 解析消息失败:', error);
      }
    };

    ws.onerror = (error) => {
      console.error('[TaskCreationAgent] WebSocket 错误:', error);
      setIsConnected(false);
    };

    ws.onclose = () => {
      console.log('[TaskCreationAgent] WebSocket 连接关闭');
      setIsConnected(false);
    };

    wsRef.current = ws;
  }, []);

  // 断开连接
  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setIsConnected(false);
  }, []);

  // 发送用户输入
  const sendUserInput = useCallback((input: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.error('[TaskCreationAgent] WebSocket 未连接');
      return;
    }

    setIsProcessing(true);
    setCurrentQuestion(null);
    setMessages((prev) => [
      ...prev,
      {
        type: 'user_input',
        content: input,
      },
    ]);

    wsRef.current.send(
      JSON.stringify({
        type: 'user_input',
        content: input,
        sessionId: sessionId || undefined,
      })
    );
  }, [sessionId]);

  const sendChatInput = useCallback((input: string) => {
    const text = input.trim();
    if (!text) return;

    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.error('[TaskCreationAgent] WebSocket 未连接');
      return;
    }

    const orchestratorId = (orchestratorSessionId || '').trim();
    if (orchestratorId && !currentQuestion) {
      setMessages((prev) => [
        ...prev,
        {
          type: 'user_input',
          content: text,
        },
      ]);

      wsRef.current.send(
        JSON.stringify({
          type: 'opencode_input',
          content: text,
          sessionId: sessionId || undefined,
          metadata: {
            orchestratorSessionId: orchestratorId,
          },
        })
      );
      return;
    }

    sendUserInput(text);
  }, [currentQuestion, orchestratorSessionId, sendUserInput, sessionId]);

  // 回答澄清问题
  const answerQuestion = useCallback((answer: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.error('[TaskCreationAgent] WebSocket 未连接');
      return;
    }

    wsRef.current.send(
      JSON.stringify({
        type: 'user_response',
        content: answer,
        sessionId: sessionId || undefined,
      })
    );

    setMessages((prev) => [
      ...prev,
      {
        type: 'user_response',
        content: answer,
      },
    ]);
    setCurrentQuestion(null);
  }, [sessionId]);

  // 清空消息
  const clearMessages = useCallback(() => {
    setMessages([]);
    setCurrentQuestion(null);
  }, []);

  const loadHistory = useCallback(async (historySessionId: string) => {
    try {
      const list = await listTaskCreationMessages(historySessionId);
      const compacted = compactHistoryMessages(list);
      const mapped: AgentMessage[] = compacted.map((item: any) => {
        const metadata = item?.metadata || {};
        const messageType = item?.messageType;
        const role = item?.role;

        if (messageType === 'opencode_agent_input' || messageType === 'opencode_user_input') {
          return null;
        }

        if (role === 'user') {
          return {
            type: messageType === 'user_response' ? 'user_response' : 'user_input',
            content: item?.content || '',
            sessionId: historySessionId,
            metadata,
          };
        }

        if (messageType === 'plan_generated') {
          return {
            type: 'plan_generated',
            plan: metadata?.plan,
            content: item?.content,
            sessionId: historySessionId,
            metadata,
          };
        }

        if (messageType === 'clarification_request') {
          return {
            type: 'clarification_request',
            question: metadata?.question || item?.content,
            options: metadata?.options,
            content: item?.content,
            sessionId: historySessionId,
            metadata,
          };
        }

        if (messageType === 'error') {
          return {
            type: 'error',
            message: metadata?.message || item?.content,
            content: item?.content,
            sessionId: historySessionId,
            metadata,
          };
        }

        if (messageType === 'status_update') {
          return {
            type: 'status_update',
            content: item?.content || '',
            stage: metadata?.stage,
            tone: metadata?.tone || 'system',
            agent: metadata?.agent,
            sessionId: historySessionId,
            metadata,
          };
        }

        if (messageType === 'opencode_event') {
          return {
            type: 'opencode_event',
            content: item?.content || '',
            sessionId: historySessionId,
            metadata,
          };
        }

        if (messageType === 'opencode_status') {
          const looksLikeError = Boolean(metadata?.code) || Boolean(metadata?.error);
          if (looksLikeError) {
            return {
              type: 'error',
              message: item?.content || metadata?.message || 'OpenCode 执行失败',
              content: item?.content,
              sessionId: historySessionId,
              metadata,
            };
          }
          return {
            type: 'status_update',
            content: item?.content || '',
            stage: 'executing',
            tone: 'execution',
            sessionId: historySessionId,
            metadata,
          };
        }

        return {
          type: 'agent_message',
          content: item?.content || '',
          agent: metadata?.agent,
          metadata,
          sessionId: historySessionId,
        };
      });

      const filtered = mapped.filter(Boolean) as AgentMessage[];
      setMessages(filtered);

      const lastClarificationIndex = [...filtered]
        .map((msg, index) => ({ msg, index }))
        .filter(({ msg }) => msg.type === 'clarification_request')
        .map(({ index }) => index)
        .pop();
      if (lastClarificationIndex !== undefined) {
        const hasUserResponseAfter = filtered
          .slice(lastClarificationIndex + 1)
          .some((msg) => msg.type === 'user_response');
        if (!hasUserResponseAfter) {
          const clarification = filtered[lastClarificationIndex];
          if (clarification.question) {
            setCurrentQuestion({
              question: clarification.question,
              options: clarification.options,
            });
          } else {
            setCurrentQuestion(null);
          }
        } else {
          setCurrentQuestion(null);
        }
      } else {
        setCurrentQuestion(null);
      }

      const latestRuntimeSession = [...mapped]
        .reverse()
        .map((msg) => extractOrchestratorSessionId(msg))
        .find((value): value is string => Boolean(value));
      if (latestRuntimeSession) {
        setOrchestratorSessionId(latestRuntimeSession);
      } else {
        setOrchestratorSessionId(null);
        setLatestOsacMessage(null);
        setRuntimeMessages([]);
        setRuntimeError(null);
      }
    } catch (error) {
      console.error('[TaskCreationAgent] 加载历史消息失败:', error);
    }
  }, []);

  const syncRuntime = useCallback(
    async (targetSessionId?: string) => {
      const sid = (targetSessionId || orchestratorSessionId || '').trim();
      if (!sid) {
        setLatestOsacMessage(null);
        setRuntimeMessages([]);
        setRuntimeError(null);
        setIsSyncingRuntime(false);
        return;
      }

      setIsSyncingRuntime(true);
      try {
        const list = await listOsacMessages(sid, 150);
        setRuntimeError(null);
        setRuntimeMessages(list);
        setLatestOsacMessage(list.length > 0 ? list[list.length - 1] : null);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'runtime sync failed';
        setRuntimeError(message);
      } finally {
        setIsSyncingRuntime(false);
      }
    },
    [orchestratorSessionId]
  );

  useEffect(() => {
    if (!orchestratorSessionId) {
      setLatestOsacMessage(null);
      setRuntimeMessages([]);
      setRuntimeError(null);
      setIsSyncingRuntime(false);
      return;
    }

    void syncRuntime(orchestratorSessionId);
    const timer = window.setInterval(() => {
      void syncRuntime(orchestratorSessionId);
    }, 4000);

    return () => {
      window.clearInterval(timer);
    };
  }, [orchestratorSessionId, syncRuntime]);

  // 自动连接
  useEffect(() => {
    connect();

    return () => {
      disconnect();
    };
  }, [connect, disconnect]);

  useEffect(() => {
    if (isConnected && sessionId) {
      void loadHistory(sessionId);
    }
  }, [isConnected, sessionId, loadHistory]);

  return {
    isConnected,
    isProcessing,
    messages,
    sessionId,
    currentQuestion,
    runtime: {
      orchestratorSessionId,
      latestType: latestOsacMessage?.type || null,
      latestText: pickOsacMessageText(latestOsacMessage),
      syncing: isSyncingRuntime,
      error: runtimeError,
      messages: runtimeMessages,
      refresh: async () => {
        await syncRuntime();
      },
    } as OrchestrationRuntime,
    sendUserInput,
    sendChatInput,
    answerQuestion,
    clearMessages,
    connect,
    disconnect,
  };
}
