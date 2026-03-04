/**
 * 任务创建智能体 Hook
 * 
 * 管理与任务创建 WebSocket 的连接和消息交互
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useLocation, useSearch } from 'wouter';
import {
  createTaskCreationSocket,
  getOpencodeEventStreamUrl,
  getTaskCreationSession,
  listOsacMessages,
  listTaskCreationMessages,
  startTaskCreationRuntime,
  touchTaskCreationRuntime,
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
  phase?: 'ideation' | 'analysis' | 'development' | 'testing' | 'repair' | 'delivery';
  tone?: 'system' | 'intent' | 'planning' | 'execution' | 'review' | 'error';
  metadata?: any;
  question?: string;
  options?: string[];
  plan?: any;
  message?: string;
}

export interface OrchestrationRuntime {
  orchestratorSessionId: string | null;
  status: string | null;
  ready: boolean;
  starting: boolean;
  latestType: string | null;
  latestText: string | null;
  syncing: boolean;
  error: string | null;
  messages: OsacMessageRecord[];
  refresh: () => Promise<void>;
  ensure: () => Promise<void>;
}

export interface UseTaskCreationAgentOptions {
  onPlanGenerated?: (plan: any) => void;
  onError?: (error: string) => void;
  autoRuntime?: boolean;
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

function compactText(value: string, maxLen: number = 320): string {
  const text = value.trim().replace(/\s+/g, ' ');
  if (!text) return '';
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen)}...`;
}

function normalizeRuntimeStatus(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) {
    return value.trim().toLowerCase();
  }
  return null;
}

function findSessionId(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = findSessionId(item);
      if (hit) return hit;
    }
    return '';
  }
  const record = value as Record<string, unknown>;
  const direct =
    (typeof record.sessionID === 'string' && record.sessionID.trim()) ||
    (typeof record.sessionId === 'string' && record.sessionId.trim());
  if (direct) return direct;
  for (const child of Object.values(record)) {
    const hit = findSessionId(child);
    if (hit) return hit;
  }
  return '';
}

function extractStreamContent(eventType: string, event: Record<string, unknown>) {
  if (eventType !== 'message.part.delta' && eventType !== 'message.part.updated') {
    return null;
  }
  const properties = toRecord(event.properties);
  const part = toRecord(properties.part);
  const partType = (asText(part.type) || asText(properties.type)).toLowerCase();
  if (partType && partType !== 'text') {
    return null;
  }
  const delta = asText(properties.delta);
  const text = asText(part.text) || asText(part.content) || asText(properties.text);
  if (!delta && !text) return null;
  const partId = asText(part.id) || asText(part.callID) || asText(properties.partId);
  return {
    text: delta || text,
    partId,
    isDelta: Boolean(delta),
  };
}

function summarizeOpencodeEvent(eventType: string, event: Record<string, unknown>): string {
  const properties = toRecord(event.properties);
  const part = toRecord(properties.part);
  const partType = (asText(part.type) || asText(properties.type)).toLowerCase();
  const toolName =
    asText(part.tool) ||
    asText(part.name) ||
    asText(properties.tool) ||
    asText(properties.name);

  if (eventType === 'message.updated') {
    const info = toRecord(properties.info);
    const state = asText(info.state) || asText(info.status) || asText(properties.state) || asText(properties.status);
    const role = asText(info.role) || asText(properties.role);
    if (state || role) {
      return `[Message] ${[role, state].filter(Boolean).join(' · ')}`;
    }
  }

  if (eventType === 'message.part.updated' || eventType === 'message.part.delta') {
    const partState = toRecord(part.state);
    const partStatus = asText(partState.state) || asText(partState.status);
    if (partType === 'tool') {
      const summary = asText(part.summary) || asText(properties.summary);
      const suffix = summary || partStatus;
      const label = toolName || 'tool';
      return suffix ? `[Tool] ${label} · ${suffix}` : `[Tool] ${label}`;
    }
    if (partType === 'text') {
      const text = asText(part.text) || asText(part.content) || asText(properties.text);
      if (text) return compactText(text, 320);
      return partStatus ? `[Text] ${partStatus}` : '[Text] updated';
    }
    if (partType === 'file') {
      const filePath = asText(part.path) || asText(properties.path);
      return filePath ? `[File] ${filePath}` : '[File] updated';
    }
  }

  if (eventType === 'command.executed') {
    const name = asText(properties.name) || asText(properties.command);
    const args = asText(properties.arguments);
    const output = compactText(asText(properties.output), 140);
    const command = [name, args].filter(Boolean).join(' ');
    if (command && output) return `[Command] ${command} -> ${output}`;
    return command ? `[Command] ${command}` : '[Command] executed';
  }

  if (eventType === 'file.edited') {
    const path = asText(properties.file) || asText(properties.path);
    return path ? `[File] edited ${path}` : '[File] edited';
  }

  if (eventType.startsWith('pty.')) {
    const command = asText(properties.command);
    const cwd = asText(properties.cwd);
    const exitCode = asText(properties.exitCode);
    const suffix = [command, cwd ? `cwd=${cwd}` : '', exitCode ? `exit=${exitCode}` : '']
      .filter(Boolean)
      .join(' · ');
    return suffix ? `[PTY] ${suffix}` : `[PTY] ${eventType}`;
  }

  const fallback =
    asText(properties.text) ||
    asText(properties.message) ||
    asText(part.text) ||
    asText(part.content);
  if (fallback) return compactText(fallback, 320);
  return `[OpenCode] ${eventType}`;
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
  return (
    content.includes('OpenCode 执行完成') ||
    content.includes('OpenCode 执行失败') ||
    content.includes('OpenCode 执行已结束')
  );
}

function mergeRealtimeMessage(
  prev: AgentMessage[],
  message: AgentMessage,
  welcomeMessage: string
): AgentMessage[] {
  if (message.type === 'error') {
    return prev;
  }
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
      const existing = next[idx];
      const nextContent =
        metadata.streamDelta === true && (existing?.content || '').trim()
          ? `${existing?.content || ''}${message.content || ''}`
          : message.content;
      next[idx] = {
        ...next[idx],
        ...message,
        content: nextContent,
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
    const hasFinal = prev.some((item) => {
      if (item.type !== 'opencode_event') return false;
      const itemMeta = toRecord(item.metadata);
      const eventType = asText(itemMeta.eventType);
      return eventType === 'message.final' || itemMeta.source === 'stream_aggregate';
    });
    if (!hasFinal) {
      return [...prev, message];
    }
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
  const hasFinalInResult = () =>
    result.some((item) => {
      if (asText(item?.messageType) !== 'opencode_event') return false;
      const metadata = toRecord(item?.metadata);
      const eventType = asText(metadata.eventType);
      return eventType === 'message.final' || metadata.source === 'stream_aggregate';
    });

  const isDeltaStream = (metadata: Record<string, unknown>) => {
    const eventType = asText(metadata.eventType).toLowerCase();
    if (eventType === 'message.part.delta') return true;
    return Boolean(metadata.streamDelta);
  };

  for (const item of list) {
    const messageType = asText(item?.messageType);
    const metadata = toRecord(item?.metadata);
    if (messageType === 'error' || messageType === 'opencode_error') {
      continue;
    }

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
        const existing = result[existingIndex];
        if (isDeltaStream(metadata)) {
          const nextContent = `${existing?.content || ''}${item?.content || ''}`;
          result[existingIndex] = {
            ...existing,
            ...item,
            content: nextContent,
          };
        } else {
          result[existingIndex] = item;
        }
      } else {
        streamIndexByKey.set(streamKey, result.length);
        result.push(item);
      }
      continue;
    }

    if (messageType === 'status_update') {
      const content = asText(item?.content);
      if (
        content.includes('OpenCode 执行完成') ||
        content.includes('OpenCode 执行失败') ||
        content.includes('OpenCode 执行已结束')
      ) {
        if (hasFinalInResult()) {
          const filtered = result.filter((existing) => {
            if (asText(existing?.messageType) !== 'opencode_event') return true;
            return !isTextStreamEvent(toRecord(existing?.metadata), existing?.content);
          });
          result.length = 0;
          result.push(...filtered);
          streamIndexByKey.clear();
        }
      }
    }

    if (messageType === 'opencode_status') {
      const content = asText(item?.content);
      if (
        content.includes('OpenCode 执行完成') ||
        content.includes('OpenCode 执行失败') ||
        content.includes('OpenCode 执行已结束')
      ) {
        if (hasFinalInResult()) {
          const filtered = result.filter((existing) => {
            if (asText(existing?.messageType) !== 'opencode_event') return true;
            return !isTextStreamEvent(toRecord(existing?.metadata), existing?.content);
          });
          result.length = 0;
          result.push(...filtered);
        }
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
  const autoRuntime = options?.autoRuntime !== false;
  const [isConnected, setIsConnected] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [currentQuestion, setCurrentQuestion] = useState<{
    question: string;
    options?: string[];
  } | null>(null);
  const [orchestratorSessionId, setOrchestratorSessionId] = useState<string | null>(null);
  const [runtimeStatus, setRuntimeStatus] = useState<string | null>(null);
  const [runtimeStarting, setRuntimeStarting] = useState(false);
  const [latestOsacMessage, setLatestOsacMessage] = useState<OsacMessageRecord | null>(null);
  const [runtimeMessages, setRuntimeMessages] = useState<OsacMessageRecord[]>([]);
  const [isSyncingRuntime, setIsSyncingRuntime] = useState(false);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [runtimeEnabled, setRuntimeEnabled] = useState(autoRuntime);
  const [location] = useLocation();
  const search = useSearch();

  const wsRef = useRef<WebSocket | null>(null);
  const sseRef = useRef<EventSource | null>(null);
  const sseActiveRef = useRef(false);
  const onPlanGeneratedRef = useRef(options?.onPlanGenerated);
  const onErrorRef = useRef(options?.onError);
  const ensureRuntimeRef = useRef<() => Promise<void>>(async () => {});
  const startRuntimeOnNextSessionRef = useRef(false);

  const resetConversationState = useCallback((nextSessionId: string | null = null) => {
    setMessages([]);
    setCurrentQuestion(null);
    setOrchestratorSessionId(null);
    setRuntimeStatus(null);
    setRuntimeStarting(false);
    setLatestOsacMessage(null);
    setRuntimeMessages([]);
    setRuntimeError(null);
    setRuntimeEnabled(autoRuntime);
    setSessionId(nextSessionId);
    if (nextSessionId) {
      window.localStorage.setItem(SESSION_STORAGE_KEY, nextSessionId);
    } else {
      window.localStorage.removeItem(SESSION_STORAGE_KEY);
    }
  }, [autoRuntime]);

  useEffect(() => {
    const params = new URLSearchParams(search);
    const querySessionId = params.get('sessionId')?.trim();
    const createNewToken = params.get('new')?.trim();
    const pathMatch = location.match(/^\/session\/([^/?#]+)/);
    const pathSessionId = pathMatch ? decodeURIComponent(pathMatch[1]) : '';
    const resolvedSessionId = pathSessionId || querySessionId || '';

    if (createNewToken) {
      if (sessionId !== null || messages.length > 0) {
        resetConversationState(null);
      }
      return;
    }

    if (resolvedSessionId) {
      if (resolvedSessionId !== sessionId) {
        resetConversationState(resolvedSessionId);
      }
      return;
    }
  }, [location, search, sessionId, messages.length, resetConversationState]);

  useEffect(() => {
    setRuntimeEnabled(autoRuntime);
  }, [autoRuntime, sessionId]);

  useEffect(() => {
    onPlanGeneratedRef.current = options?.onPlanGenerated;
    onErrorRef.current = options?.onError;
  }, [options?.onPlanGenerated, options?.onError]);

  const closeSse = useCallback(() => {
    if (sseRef.current) {
      sseRef.current.close();
      sseRef.current = null;
    }
    sseActiveRef.current = false;
  }, []);

  const runtimeReady =
    runtimeEnabled && (runtimeStatus === 'ready' || (!runtimeStatus && Boolean(orchestratorSessionId)));

  const refreshRuntimeStatus = useCallback(
    async (targetSessionId?: string) => {
      const sid = (targetSessionId || sessionId || '').trim();
      if (!sid) return;
      try {
        const detail = await getTaskCreationSession(sid);
        if (!detail) return;
        const nextOrchestrator = (detail.runtime?.orchestratorSessionId || '').trim();
        if (nextOrchestrator) {
          setOrchestratorSessionId(nextOrchestrator);
        } else if (!orchestratorSessionId) {
          setOrchestratorSessionId(null);
        }
        const nextStatus =
          normalizeRuntimeStatus(detail.runtimeStatus?.status) ||
          (nextOrchestrator ? 'ready' : null);
        setRuntimeStatus(nextStatus);
      } catch (error) {
        console.warn('[TaskCreationAgent] 获取执行环境状态失败:', error);
      }
    },
    [orchestratorSessionId, sessionId]
  );

  const handleSsePayload = useCallback((payload: any) => {
    if (!payload || typeof payload !== 'object') return;
    if (payload.status === 'ready') return;
    const event = toRecord(payload.event);
    if (!event || Object.keys(event).length === 0) return;

    const eventType = asText(event.type) || 'unknown';
    const stream = extractStreamContent(eventType, event);
    const opencodeSessionId = asText(payload.opencodeSessionId) || findSessionId(event) || '';

    const metadata: Record<string, unknown> = {
      eventType,
      event,
      rawPayload: { event },
      opencodeSessionId: opencodeSessionId || undefined,
    };

    let content = '';
    if (stream) {
      content = stream.text;
      metadata.stream = true;
      if (stream.partId) {
        metadata.partId = stream.partId;
      }
      metadata.streamDelta = stream.isDelta === true;
    } else {
      content = summarizeOpencodeEvent(eventType, event);
    }

    if (!content) {
      content = `[OpenCode] ${eventType}`;
    }

    const message: AgentMessage = {
      type: 'opencode_event',
      content,
      metadata,
      sessionId: sessionId || undefined,
    };

    setMessages((prev) => mergeRealtimeMessage(prev, message, WELCOME_MESSAGE));
  }, [sessionId, WELCOME_MESSAGE]);

  const openSse = useCallback(
    (targetSessionId: string) => {
      const url = getOpencodeEventStreamUrl(targetSessionId);
      closeSse();
      const source = new EventSource(url);
      sseRef.current = source;

      source.onopen = () => {
        sseActiveRef.current = true;
      };

      source.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          handleSsePayload(payload);
        } catch (error) {
          console.warn('[TaskCreationAgent] SSE 解析失败:', error);
        }
      };

      source.addEventListener('ready', (event: MessageEvent) => {
        try {
          const payload = JSON.parse(event.data);
          handleSsePayload(payload);
        } catch {
          // ignore ready parse errors
        }
      });

      source.onerror = () => {
        sseActiveRef.current = false;
        void refreshRuntimeStatus(targetSessionId);
      };
    },
    [closeSse, handleSsePayload, refreshRuntimeStatus]
  );

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
        if (message.type === 'error') {
          return;
        }
        if (message.type === 'opencode_event' && sseActiveRef.current) {
          return;
        }
        const messageSessionId = message.sessionId || message.metadata?.sessionId;
        if (messageSessionId) {
          setSessionId(messageSessionId);
          window.localStorage.setItem(SESSION_STORAGE_KEY, messageSessionId);
          const params = new URLSearchParams(window.location.search);
          const currentPath = window.location.pathname;
          const currentMatch = currentPath.match(/^\/session\/([^/?#]+)/);
          const currentInPath = currentMatch ? decodeURIComponent(currentMatch[1]) : '';
          if (currentInPath !== messageSessionId || params.get('new') || params.get('sessionId')) {
            params.delete('new');
            params.delete('sessionId');
            const query = params.toString();
            const base = `/session/${encodeURIComponent(messageSessionId)}`;
            window.history.replaceState(null, '', query ? `${base}?${query}` : base);
          }

          if (startRuntimeOnNextSessionRef.current && autoRuntime) {
            startRuntimeOnNextSessionRef.current = false;
            void ensureRuntimeRef.current();
          }
        }
        const orchestratorId = extractOrchestratorSessionId(message);
        if (orchestratorId) {
          setOrchestratorSessionId(orchestratorId);
          setRuntimeStatus('ready');
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
      const ordered = [...list].sort((a, b) => {
        const ta = a?.createdAt ? Date.parse(a.createdAt) : NaN;
        const tb = b?.createdAt ? Date.parse(b.createdAt) : NaN;
        if (Number.isNaN(ta) || Number.isNaN(tb)) return 0;
        return ta - tb;
      });
      const compacted = compactHistoryMessages(ordered);
      const mapped: AgentMessage[] = compacted.map((item: any) => {
        const metadata = item?.metadata || {};
        const messageType = item?.messageType;
        const role = item?.role;

        if (messageType === 'opencode_agent_input' || messageType === 'opencode_user_input') {
          return null;
        }
        if (messageType === 'error' || messageType === 'opencode_error') {
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
            return null;
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
        setRuntimeStatus('ready');
      } else {
        setOrchestratorSessionId(null);
        setRuntimeStatus(null);
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
      if (!runtimeEnabled) {
        setLatestOsacMessage(null);
        setRuntimeMessages([]);
        setRuntimeError(null);
        setIsSyncingRuntime(false);
        return;
      }
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
    [orchestratorSessionId, runtimeEnabled]
  );

  const ensureRuntime = useCallback(async () => {
    const sid = (sessionId || '').trim();
    if (!sid || runtimeStarting || runtimeReady) return;
    if (!runtimeEnabled) {
      setRuntimeEnabled(true);
    }
    setRuntimeStarting(true);
    try {
      const result = await startTaskCreationRuntime(sid);
      const nextOrchestrator = (result?.orchestratorSessionId || '').trim();
      if (nextOrchestrator) {
        setOrchestratorSessionId(nextOrchestrator);
      }
      const nextStatus = normalizeRuntimeStatus(result?.status) || 'ready';
      setRuntimeStatus(nextStatus);
      setRuntimeError(null);
      if (nextOrchestrator) {
        await syncRuntime(nextOrchestrator);
      }
    } catch (error) {
      console.warn('[TaskCreationAgent] 启动执行环境失败:', error);
    } finally {
      setRuntimeStarting(false);
    }
  }, [runtimeStarting, sessionId, runtimeEnabled, runtimeReady, syncRuntime]);

  useEffect(() => {
    ensureRuntimeRef.current = ensureRuntime;
  }, [ensureRuntime]);

  useEffect(() => {
    if (!orchestratorSessionId || !runtimeReady || !runtimeEnabled) {
      setIsSyncingRuntime(false);
      setRuntimeError(null);
      return;
    }

    void syncRuntime(orchestratorSessionId);
    const timer = window.setInterval(() => {
      void syncRuntime(orchestratorSessionId);
    }, 4000);

    return () => {
      window.clearInterval(timer);
    };
  }, [orchestratorSessionId, runtimeReady, runtimeEnabled, syncRuntime]);

  useEffect(() => {
    if (!sessionId || !orchestratorSessionId || !runtimeReady || !runtimeEnabled) {
      return;
    }
    let cancelled = false;
    const envMs = (import.meta as any)?.env?.VITE_RUNTIME_KEEPALIVE_MS;
    const intervalMs = Math.max(15000, Number(envMs || 30000));

    const touch = async () => {
      if (cancelled) return;
      if (document.hidden) return;
      try {
        await touchTaskCreationRuntime(sessionId);
      } catch {
        // keepalive failure is non-fatal
      }
    };

    void touch();
    const timer = window.setInterval(() => {
      void touch();
    }, intervalMs);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [sessionId, orchestratorSessionId, runtimeReady, runtimeEnabled]);

  // 自动连接
  useEffect(() => {
    connect();

    return () => {
      closeSse();
      disconnect();
    };
  }, [connect, disconnect, closeSse]);

  useEffect(() => {
    if (isConnected && sessionId) {
      void loadHistory(sessionId);
    }
  }, [isConnected, sessionId, loadHistory]);

  useEffect(() => {
    if (sessionId) {
      void refreshRuntimeStatus(sessionId);
    }
  }, [sessionId, refreshRuntimeStatus]);

  useEffect(() => {
    if (!sessionId || !orchestratorSessionId || !runtimeReady || !runtimeEnabled) {
      closeSse();
      return;
    }
    openSse(sessionId);
    return () => {
      closeSse();
    };
  }, [sessionId, orchestratorSessionId, runtimeReady, runtimeEnabled, openSse, closeSse]);

  // 发送用户输入
  const sendUserInput = useCallback((input: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.error('[TaskCreationAgent] WebSocket 未连接');
      return;
    }

    startRuntimeOnNextSessionRef.current = true;
    if (autoRuntime && runtimeEnabled && sessionId && !runtimeReady && !runtimeStarting) {
      void ensureRuntime();
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
  }, [autoRuntime, runtimeEnabled, runtimeReady, runtimeStarting, ensureRuntime, sessionId]);

  const sendChatInput = useCallback(async (input: string) => {
    const text = input.trim();
    if (!text) return;

    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.error('[TaskCreationAgent] WebSocket 未连接');
      return;
    }

    const orchestratorId = (orchestratorSessionId || '').trim();
    if (orchestratorId && !currentQuestion) {
      if (!runtimeReady) {
        await ensureRuntime();
      }
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
  }, [currentQuestion, orchestratorSessionId, runtimeReady, ensureRuntime, sendUserInput, sessionId]);

  return {
    isConnected,
    isProcessing,
    messages,
    sessionId,
    currentQuestion,
    runtime: {
      orchestratorSessionId,
      status: runtimeStatus,
      ready: runtimeReady,
      starting: runtimeStarting,
      latestType: latestOsacMessage?.type || null,
      latestText: pickOsacMessageText(latestOsacMessage),
      syncing: isSyncingRuntime,
      error: runtimeError,
      messages: runtimeMessages,
      refresh: async () => {
        if (!runtimeReady) {
          await ensureRuntime();
          return;
        }
        await syncRuntime();
      },
      ensure: async () => {
        await ensureRuntime();
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
