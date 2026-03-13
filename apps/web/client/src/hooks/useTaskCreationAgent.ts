/**
 * 任务创建智能体 Hook
 * 
 * 管理与任务创建 WebSocket 的连接和消息交互
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useLocation, useSearch } from 'wouter';
import {
  createTaskCreationSession,
  createTaskCreationDraftSession,
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
  opencodeSessionId: string | null;
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
  compactHistory?: boolean;
}

type SendInputOptions = {
  metadata?: Record<string, unknown>;
  sessionId?: string;
};

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

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const raw = value.trim();
    if (!raw) return null;
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
    const asDate = Date.parse(raw);
    if (!Number.isNaN(asDate)) {
      return asDate;
    }
  }
  return null;
}

function asPositiveInt(value: unknown): number | null {
  const parsed = asFiniteNumber(value);
  if (parsed === null) return null;
  if (parsed <= 0) return null;
  return Math.floor(parsed);
}

function compactText(value: string, maxLen: number = 320): string {
  const text = value.trim().replace(/\s+/g, ' ');
  if (!text) return '';
  return text;
}

// Altus 控制模式存储键：
// - sandbox: 直通 sandbox 执行器（OpenCode/ClaudeCode/Codex 等）
// - managed: Altus 三层智能体编排
// 注意：直通模式不应触发 Altus 编排与澄清逻辑，避免误走流程。
const ALTUS_MODE_STORAGE_KEY = 'altus_mode';
const EXECUTOR_STORAGE_KEY = 'altus_executor';
const SSE_CLIENT_ID_STORAGE_KEY = 'task_creation_sse_client_id';

function readAltusMode(): 'sandbox' | 'managed' {
  if (typeof window === 'undefined') return 'sandbox';
  try {
    const stored = window.localStorage.getItem(ALTUS_MODE_STORAGE_KEY);
    if (stored === 'managed' || stored === 'sandbox') {
      return stored;
    }
    window.localStorage.setItem(ALTUS_MODE_STORAGE_KEY, 'sandbox');
  } catch {
    // ignore storage failures
  }
  return 'sandbox';
}

function readExecutor(): 'opencode' | 'claudecode' | 'codex' {
  if (typeof window === 'undefined') return 'opencode';
  try {
    const stored = window.localStorage.getItem(EXECUTOR_STORAGE_KEY);
    if (stored === 'claudecode' || stored === 'codex' || stored === 'opencode') {
      return stored;
    }
    window.localStorage.setItem(EXECUTOR_STORAGE_KEY, 'opencode');
  } catch {
    // ignore storage failures
  }
  return 'opencode';
}

function getOrCreateSseClientId(): string {
  if (typeof window === 'undefined') {
    return 'sse_client_server';
  }
  try {
    const existing = window.localStorage.getItem(SSE_CLIENT_ID_STORAGE_KEY);
    if (existing && existing.trim()) {
      return existing.trim();
    }
    const nextId =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `sse_client_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    window.localStorage.setItem(SSE_CLIENT_ID_STORAGE_KEY, nextId);
    return nextId;
  } catch {
    return `sse_client_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }
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
  return '';
}

type OpencodeEventInfo = {
  eventType: string;
  event: Record<string, unknown>;
  properties: Record<string, unknown>;
  part: Record<string, unknown>;
  partType: string;
  partId: string;
  toolName: string;
  role: string;
};

function getOpencodeEventInfo(metadata: Record<string, unknown>): OpencodeEventInfo {
  const rawPayload = toRecord(metadata.rawPayload);
  const eventFromMeta = toRecord(metadata.event);
  const eventFromPayload = toRecord(rawPayload.event);
  const event = Object.keys(eventFromMeta).length > 0 ? eventFromMeta : eventFromPayload;
  const eventType = asText(metadata.eventType) || asText(event.type);
  const properties = toRecord(event.properties);
  const part = toRecord(properties.part);
  const message = toRecord(properties.message);
  const partType = (asText(part.type) || asText(properties.type)).toLowerCase();
  const toolName = asText(part.tool) || asText(part.name) || asText(properties.tool);
  const partId = asText(part.id) || asText(part.callID) || asText(properties.partId);
  const role = (asText(message.role) || asText(properties.role) || asText(part.role)).toLowerCase();
  return {
    eventType,
    event,
    properties,
    part,
    partType,
    partId,
    toolName,
    role,
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

function resolveTextStreamKeyFromMetadata(metadata: Record<string, unknown>): string | null {
  const explicit = asText(metadata.streamKey);
  if (explicit) return explicit;

  const { partId } = getOpencodeEventInfo(metadata);
  const opencodeSessionId = asText(metadata.opencodeSessionId);
  if (opencodeSessionId && partId) {
    return `${opencodeSessionId}:${partId}`;
  }
  return null;
}

function isTextStreamEvent(metadata: Record<string, unknown>, content?: string): boolean {
  const { role } = getOpencodeEventInfo(metadata);
  if (role === 'user') {
    return false;
  }
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
  const { eventType, partType, toolName, role } = getOpencodeEventInfo(metadata);
  if (role === 'user') return false;
  if (eventType !== 'message.part.updated' && eventType !== 'message.part.delta') {
    return false;
  }
  if (!partType || partType !== 'tool') return false;
  if (toolName.toLowerCase() === 'todoread') return false;
  return true;
}

function shouldDisplayOpencodeEvent(metadata: Record<string, unknown>, content?: string): boolean {
  const { eventType, partType, toolName, role } = getOpencodeEventInfo(metadata);
  if (role === 'user') {
    return false;
  }
  const text = (content || '').trim();

  if (metadata.stream === true) {
    return isTextStreamEvent(metadata, content);
  }

  if (eventType === 'message.final') {
    return Boolean(text);
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
    eventType === 'command.executed'
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

function resolveOpencodeToolName(metadataRaw: unknown): string {
  const metadata = toRecord(metadataRaw);
  const eventType = asText(metadata.eventType).toLowerCase();
  if (eventType !== 'message.part.updated' && eventType !== 'message.part.delta') {
    return '';
  }
  const rawPayload = toRecord(metadata.rawPayload);
  const eventFromMeta = toRecord(metadata.event);
  const eventFromPayload = toRecord(rawPayload.event);
  const event = Object.keys(eventFromMeta).length > 0 ? eventFromMeta : eventFromPayload;
  const properties = toRecord(event.properties);
  const part = toRecord(properties.part);
  return (
    asText(part.tool) ||
    asText(part.name) ||
    asText(properties.tool) ||
    asText(properties.name)
  ).toLowerCase();
}

function isQuestionToolEvent(metadataRaw: unknown): boolean {
  return resolveOpencodeToolName(metadataRaw) === 'question';
}

export function shouldStopProcessingForMessage(message: AgentMessage): boolean {
  if (message.type === 'clarification_request' || message.type === 'plan_generated') {
    return true;
  }

  if (message.type === 'status_update') {
    if (message.stage === 'completed' || message.stage === 'failed') {
      return true;
    }
    return isTerminalOpencodeMessage(message);
  }

  if (message.type !== 'opencode_event') {
    return false;
  }

  const metadata = toRecord(message.metadata);
  if (isQuestionToolEvent(metadata)) {
    return true;
  }

  const eventType = asText(metadata.eventType).toLowerCase();
  if (
    eventType === 'message.final' ||
    eventType === 'session.idle' ||
    eventType === 'session.error' ||
    eventType === 'session.completed'
  ) {
    return true;
  }

  if (eventType === 'session.status') {
    const event = toRecord(metadata.event);
    const properties = toRecord(event.properties);
    const state =
      asText(toRecord(properties.state).state).toLowerCase() ||
      asText(properties.state).toLowerCase() ||
      asText(properties.status).toLowerCase();
    if (state === 'idle' || state === 'error' || state === 'failed') {
      return true;
    }
  }

  return false;
}

function mergeRealtimeMessage(
  prev: AgentMessage[],
  message: AgentMessage,
  welcomeMessage: string
): AgentMessage[] {
  if (message.type === 'error') {
    const errorText = (message.message || message.content || '').trim();
    if (!errorText) {
      return prev;
    }
    const lastMessage = prev[prev.length - 1];
    const lastErrorText = (lastMessage?.message || lastMessage?.content || '').trim();
    if (lastMessage?.type === 'error' && lastErrorText === errorText) {
      return prev;
    }
    return [
      ...prev,
      {
        ...message,
        message: errorText,
        content: errorText,
      },
    ];
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
  const isDuplicateStatus =
    message.type === 'status_update' &&
    lastMessage?.type === 'status_update' &&
    (message.content || '').trim() &&
    (message.content || '').trim() === (lastMessage?.content || '').trim();
  if (isDuplicateStatus) {
    return prev;
  }
  const isDuplicateUserMessage =
    (message.type === 'user_input' || message.type === 'user_response') &&
    lastMessage?.type === message.type &&
    (message.content || '').trim() &&
    (message.content || '').trim() === (lastMessage?.content || '').trim();
  if (isDuplicateUserMessage) {
    return prev;
  }

  const metadata = toRecord(message.metadata);
  const sessionEventSeq = asPositiveInt(metadata.sessionEventSeq);
  if (sessionEventSeq !== null) {
    const hasSameSessionEventSeq = prev.some((item) => {
      const itemMeta = toRecord(item.metadata);
      return (
        asPositiveInt(itemMeta.sessionEventSeq) === sessionEventSeq &&
        item.type === message.type
      );
    });
    if (hasSameSessionEventSeq) {
      return prev;
    }
  }
  const eventType = asText(metadata.eventType);
  const seq = asFiniteNumber(metadata.seq);
  const timestamp = asFiniteNumber(metadata.timestamp);
  if (message.type === 'opencode_event' && eventType === 'message.final') {
    const hasDuplicateFinal = prev.some((item) => {
      if (item.type !== 'opencode_event') return false;
      const itemMeta = toRecord(item.metadata);
      if (asText(itemMeta.eventType) !== 'message.final') return false;
      return (item.content || '').trim() === (message.content || '').trim();
    });
    if (hasDuplicateFinal) {
      return prev;
    }
  }
  if (message.type === 'opencode_event' && seq !== null) {
    const hasSameSeq = prev.some((item) => {
      if (item.type !== 'opencode_event') return false;
      const itemMeta = toRecord(item.metadata);
      return asFiniteNumber(itemMeta.seq) === seq && (item.content || '') === (message.content || '');
    });
    if (hasSameSeq) {
      return prev;
    }
  }
  if (message.type === 'opencode_event' && seq === null && timestamp !== null) {
    const hasSameTimestamp = prev.some((item) => {
      if (item.type !== 'opencode_event') return false;
      const itemMeta = toRecord(item.metadata);
      return (
        asFiniteNumber(itemMeta.timestamp) === timestamp &&
        asText(itemMeta.eventType) === eventType &&
        (item.content || '') === (message.content || '')
      );
    });
    if (hasSameTimestamp) {
      return prev;
    }
  }
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
    const streamKey = resolveTextStreamKeyFromMetadata(metadata);
    if (!streamKey) {
      return [...prev, message];
    }

    const idx = prev.findIndex((item) => {
      if (item.type !== 'opencode_event') return false;
      const itemMeta = toRecord(item.metadata);
      if (!isTextStreamEvent(itemMeta, item.content)) return false;
      return resolveTextStreamKeyFromMetadata(itemMeta) === streamKey;
    });

    if (idx >= 0) {
      const next = [...prev];
      const existing = next[idx];
      const existingMeta = toRecord(existing.metadata);
      const chunkSignature = `${asFiniteNumber(metadata.seq) ?? 'na'}:${asFiniteNumber(metadata.timestamp) ?? 'na'}:${message.content || ''}`;
      if (metadata.streamDelta === true && chunkSignature !== 'na:na:' && asText(existingMeta._streamChunkSignature) === chunkSignature) {
        return prev;
      }
      const nextContent =
        metadata.streamDelta === true
          ? `${existing?.content || ''}${message.content || ''}`
          : message.content;
      next[idx] = {
        ...next[idx],
        ...message,
        content: nextContent,
        metadata: {
          ...toRecord(next[idx].metadata),
          ...metadata,
          _streamChunkSignature: chunkSignature !== 'na:na:' ? chunkSignature : undefined,
        },
      };
      return next;
    }

    return [...prev, message];
  }

  if (message.type === 'opencode_event' && asText(metadata.eventType) === 'message.final') {
    const finalStreamKey = resolveTextStreamKeyFromMetadata(metadata);
    if (!finalStreamKey) {
      return [...prev, message];
    }
    const filtered = prev.filter((item) => {
      if (item.type !== 'opencode_event') return true;
      const itemMeta = toRecord(item.metadata);
      if (!isTextStreamEvent(itemMeta, item.content)) return true;
      return resolveTextStreamKeyFromMetadata(itemMeta) !== finalStreamKey;
    });
    return [...filtered, message];
  }

  if (message.type === 'status_update' && isTerminalOpencodeMessage(message)) {
    const normalized = (message.content || '').trim();
    if (!normalized) {
      return prev;
    }
    const exists = prev.some(
      (item) =>
        item.type === 'status_update' &&
        isTerminalOpencodeMessage(item) &&
        (item.content || '').trim() === normalized
    );
    if (exists) {
      return prev;
    }
    return [...prev, message];
  }

  return [...prev, message];
}

function compactHistoryMessages(list: TaskCreationHistoryMessage[]): TaskCreationHistoryMessage[] {
  const result: TaskCreationHistoryMessage[] = [];
  const streamIndexByKey = new Map<string, number>();
  const streamSignatureByKey = new Map<string, string>();

  const isDeltaStream = (metadata: Record<string, unknown>) => {
    const eventType = asText(metadata.eventType).toLowerCase();
    if (eventType === 'message.part.delta') return true;
    return Boolean(metadata.streamDelta);
  };

  for (const item of list) {
    const messageType = asText(item?.messageType);
    const metadata = toRecord(item?.metadata);
    if (messageType === 'session_started') {
      continue;
    }
    if (messageType === 'error' || messageType === 'opencode_error') {
      continue;
    }

    if (messageType === 'opencode_event' && asText(metadata.eventType) === 'message.final') {
      const finalStreamKey = resolveTextStreamKeyFromMetadata(metadata);
      if (!finalStreamKey) {
        result.push(item);
        continue;
      }
      const filtered = result.filter((existing) => {
        if (asText(existing?.messageType) !== 'opencode_event') return true;
        const existingMeta = toRecord(existing?.metadata);
        if (!isTextStreamEvent(existingMeta, existing?.content)) return true;
        return resolveTextStreamKeyFromMetadata(existingMeta) !== finalStreamKey;
      });
      result.length = 0;
      result.push(...filtered, item);
      streamIndexByKey.clear();
      streamSignatureByKey.clear();
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
      const streamKey = resolveTextStreamKeyFromMetadata(metadata);
      if (!streamKey) {
        result.push(item);
        continue;
      }

      const existingIndex = streamIndexByKey.get(streamKey);
      if (existingIndex !== undefined) {
        const signature = `${asFiniteNumber(metadata.seq) ?? 'na'}:${asFiniteNumber(metadata.timestamp) ?? 'na'}:${item?.content || ''}`;
        if (signature !== 'na:na:' && streamSignatureByKey.get(streamKey) === signature) {
          continue;
        }
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
        if (signature !== 'na:na:') {
          streamSignatureByKey.set(streamKey, signature);
        }
      } else {
        streamIndexByKey.set(streamKey, result.length);
        result.push(item);
        const signature = `${asFiniteNumber(metadata.seq) ?? 'na'}:${asFiniteNumber(metadata.timestamp) ?? 'na'}:${item?.content || ''}`;
        if (signature !== 'na:na:') {
          streamSignatureByKey.set(streamKey, signature);
        }
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
        streamIndexByKey.clear();
        streamSignatureByKey.clear();
      }
    }

    if (messageType === 'opencode_status') {
      const content = asText(item?.content);
      if (
        content.includes('OpenCode 执行完成') ||
        content.includes('OpenCode 执行失败') ||
        content.includes('OpenCode 执行已结束')
      ) {
        // keep text events; only reset stream compaction state for any subsequent run.
      }
      streamIndexByKey.clear();
      streamSignatureByKey.clear();
    }

    result.push(item);
  }

  return result;
}

export function useTaskCreationAgent(options?: UseTaskCreationAgentOptions) {
  const SESSION_STORAGE_KEY = 'task_creation_session_id';
  const WELCOME_MESSAGE = '欢迎使用 Altus 任务创建助手！请描述您想要创建的任务。';
  const autoRuntime = options?.autoRuntime !== false;
  const compactHistory = options?.compactHistory !== false;
  const [isConnected, setIsConnected] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [currentQuestion, setCurrentQuestion] = useState<{
    question: string;
    options?: string[];
  } | null>(null);
  const [orchestratorSessionId, setOrchestratorSessionId] = useState<string | null>(null);
  const [opencodeSessionId, setOpencodeSessionId] = useState<string | null>(null);
  const [runtimeStatus, setRuntimeStatus] = useState<string | null>(null);
  const [runtimeStarting, setRuntimeStarting] = useState(false);
  const [latestOsacMessage, setLatestOsacMessage] = useState<OsacMessageRecord | null>(null);
  const [runtimeMessages, setRuntimeMessages] = useState<OsacMessageRecord[]>([]);
  const [isSyncingRuntime, setIsSyncingRuntime] = useState(false);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [runtimeEnabled, setRuntimeEnabled] = useState(autoRuntime);
  const [sseReplayHint, setSseReplayHint] = useState(0);
  const [location] = useLocation();
  const search = useSearch();

  const wsRef = useRef<WebSocket | null>(null);
  const sseRef = useRef<EventSource | null>(null);
  const sseActiveRef = useRef(false);
  const sseLastAtRef = useRef(0);
  const sseCursorRef = useRef(0);
  const sseStreamSeqRef = useRef<Map<string, number>>(new Map());
  const sseStreamClockRef = useRef<Map<string, number>>(new Map());
  const sseStreamLengthRef = useRef<Map<string, number>>(new Map());
  const sseStreamSignatureRef = useRef<Map<string, string>>(new Map());
  const sseReconnectTimerRef = useRef<number | null>(null);
  const sseReconnectAttemptRef = useRef(0);
  const ssePreferredRef = useRef(false);
  const openSseRef = useRef<(targetSessionId: string, targetOpencodeSessionId?: string) => void>(() => {});
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectingRef = useRef(false);
  const connectRef = useRef<() => void>(() => {});
  const outboundQueueRef = useRef<string[]>([]);
  const onPlanGeneratedRef = useRef(options?.onPlanGenerated);
  const onErrorRef = useRef(options?.onError);
  const ensureRuntimeRef = useRef<() => Promise<void>>(async () => {});
  const startRuntimeOnNextSessionRef = useRef(false);
  const opencodeSessionIdRef = useRef<string | null>(null);
  const sseClientIdRef = useRef<string>(getOrCreateSseClientId());
  const sseCursorKindRef = useRef<'seq' | 'timestamp' | null>(null);
  const sseBridgeStateRef = useRef<{ reconnecting?: boolean; connectedAt?: string; disconnectedAt?: string } | null>(null);

  const resetConversationState = useCallback((nextSessionId: string | null = null) => {
    setMessages([]);
    setCurrentQuestion(null);
    setOrchestratorSessionId(null);
    setOpencodeSessionId(null);
    setRuntimeStatus(null);
    setRuntimeStarting(false);
    setLatestOsacMessage(null);
    setRuntimeMessages([]);
    setRuntimeError(null);
    setRuntimeEnabled(autoRuntime);
    sseCursorRef.current = 0;
    sseCursorKindRef.current = null;
    sseStreamSeqRef.current.clear();
    sseStreamClockRef.current.clear();
    sseStreamLengthRef.current.clear();
    sseStreamSignatureRef.current.clear();
    setSessionId(nextSessionId);
    if (nextSessionId) {
      window.localStorage.setItem(SESSION_STORAGE_KEY, nextSessionId);
    } else {
      window.localStorage.removeItem(SESSION_STORAGE_KEY);
    }
  }, [autoRuntime]);

  const bindSessionId = useCallback((nextSessionId: string) => {
    if (!nextSessionId) return;
    setSessionId(nextSessionId);
    window.localStorage.setItem(SESSION_STORAGE_KEY, nextSessionId);
    const params = new URLSearchParams(window.location.search);
    const currentPath = window.location.pathname;
    const currentMatch = currentPath.match(/^\/session\/([^/?#]+)/);
    const currentInPath = currentMatch ? decodeURIComponent(currentMatch[1]) : '';
    if (currentInPath !== nextSessionId || params.get('new') || params.get('sessionId')) {
      params.delete('new');
      params.delete('sessionId');
      const query = params.toString();
      const base = `/session/${encodeURIComponent(nextSessionId)}`;
      window.history.replaceState(null, '', query ? `${base}?${query}` : base);
    }
  }, []);

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

  useEffect(() => {
    opencodeSessionIdRef.current = opencodeSessionId;
  }, [opencodeSessionId]);

  const closeSse = useCallback(() => {
    if (sseRef.current) {
      sseRef.current.close();
      sseRef.current = null;
    }
    ssePreferredRef.current = false;
    sseActiveRef.current = false;
    sseLastAtRef.current = 0;
  }, [compactHistory]);

  const clearSseReconnectTimer = useCallback(() => {
    if (sseReconnectTimerRef.current) {
      window.clearTimeout(sseReconnectTimerRef.current);
      sseReconnectTimerRef.current = null;
    }
  }, []);

  const scheduleSseReconnect = useCallback(
    (targetSessionId: string) => {
      clearSseReconnectTimer();
      const attempt = Math.min(sseReconnectAttemptRef.current + 1, 6);
      sseReconnectAttemptRef.current = attempt;
      const delayMs = Math.min(30000, 1000 * Math.pow(2, attempt));
      sseReconnectTimerRef.current = window.setTimeout(() => {
        openSseRef.current(targetSessionId, opencodeSessionIdRef.current || undefined);
      }, delayMs);
    },
    [clearSseReconnectTimer]
  );

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
        const nextOpencode = (detail.runtime?.opencodeSessionId || '').trim();
        if (nextOpencode) {
          setOpencodeSessionId(nextOpencode);
        } else if (!nextOrchestrator) {
          setOpencodeSessionId(null);
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

  const updateSseCursor = useCallback((payload: any, message?: AgentMessage) => {
    const seq =
      asFiniteNumber(message?.metadata?.seq) ??
      asFiniteNumber(payload?.metadata?.seq) ??
      asFiniteNumber(payload?.seq);
    if (seq !== null && seq > 0) {
      if (sseCursorKindRef.current !== 'seq' || seq > sseCursorRef.current) {
        sseCursorRef.current = seq;
        sseCursorKindRef.current = 'seq';
      }
      return;
    }

    const createdAt = payload?.createdAt;
    const metaTimestamp =
      typeof message?.metadata?.timestamp === 'number'
        ? message.metadata.timestamp
        : typeof payload?.metadata?.timestamp === 'number'
          ? payload.metadata.timestamp
          : undefined;
    let nextCursor = 0;
    if (typeof metaTimestamp === 'number' && Number.isFinite(metaTimestamp)) {
      nextCursor = metaTimestamp;
    } else if (typeof createdAt === 'string') {
      const parsed = Date.parse(createdAt);
      if (!Number.isNaN(parsed)) {
        nextCursor = parsed;
      }
    } else if (typeof createdAt === 'number' && Number.isFinite(createdAt)) {
      nextCursor = createdAt;
    }
    if (!nextCursor) return;
    if (sseCursorKindRef.current === 'seq') {
      return;
    }
    if (nextCursor > sseCursorRef.current || sseCursorKindRef.current !== 'timestamp') {
      sseCursorRef.current = nextCursor;
      sseCursorKindRef.current = 'timestamp';
    }
  }, []);

  const shouldAcceptStreamUpdate = useCallback(
    (message: AgentMessage, payload: any): boolean => {
      const metadata = toRecord(message.metadata);
      if (!isTextStreamEvent(metadata, message.content)) {
        return true;
      }
      const streamKey = resolveTextStreamKeyFromMetadata(metadata);
      if (!streamKey) {
        return true;
      }
      const seq =
        asFiniteNumber(metadata.seq) ??
        asFiniteNumber(toRecord(payload?.metadata).seq) ??
        asFiniteNumber(payload?.seq);
      const metaTs =
        asFiniteNumber(metadata.timestamp) ??
        asFiniteNumber(toRecord(payload?.metadata).timestamp) ??
        asFiniteNumber(payload?.createdAt);
      const isDelta = metadata.streamDelta === true;
      const content = message.content || '';
      const signature = `${seq ?? 'na'}:${metaTs ?? 'na'}:${content}`;

      const lastSeq = sseStreamSeqRef.current.get(streamKey);
      if (seq !== null && typeof lastSeq === 'number' && seq < lastSeq) {
        return false;
      }

      const lastTs = sseStreamClockRef.current.get(streamKey) || 0;
      if (seq === null && metaTs !== null && metaTs < lastTs) {
        return false;
      }

      const lastSignature = sseStreamSignatureRef.current.get(streamKey);
      if (lastSignature && lastSignature === signature) {
        return false;
      }

      const lastLen = sseStreamLengthRef.current.get(streamKey) || 0;
      if (seq === null && metaTs === null) {
        if (isDelta) {
          if (!content) {
            return false;
          }
          if (lastSignature === `na:na:${content}`) {
            return false;
          }
        } else {
          const nextLen = content.length;
          if (nextLen < lastLen) {
            return false;
          }
        }
      }

      if (seq !== null) {
        const prevSeq = sseStreamSeqRef.current.get(streamKey);
        if (typeof prevSeq !== 'number' || seq >= prevSeq) {
          sseStreamSeqRef.current.set(streamKey, seq);
        }
      }
      if (metaTs !== null) {
        const prevTs = sseStreamClockRef.current.get(streamKey) || 0;
        if (metaTs >= prevTs) {
          sseStreamClockRef.current.set(streamKey, metaTs);
        }
      }

      if (isDelta) {
        sseStreamLengthRef.current.set(streamKey, lastLen + content.length);
      } else {
        sseStreamLengthRef.current.set(streamKey, content.length);
      }
      sseStreamSignatureRef.current.set(streamKey, signature);
      return true;
    },
    []
  );

  const handleSsePayload = useCallback((payload: any) => {
    if (!payload || typeof payload !== 'object') return;
    if (payload.status === 'ready') return;
    if (payload.type) {
      const message: AgentMessage = {
        type: payload.type,
        content: payload.content || payload.message || '',
        metadata: payload.metadata,
        stage: payload.stage,
        phase: payload.phase,
        tone: payload.tone,
        agent: payload.agent,
        sessionId: payload.sessionId || sessionId || undefined,
      };
      if (message.type === 'error') {
        const errorText = (message.message || message.content || '请求失败，请稍后重试').trim();
        setIsProcessing(false);
        setMessages((prev) => [
          ...prev,
          {
            type: 'error',
            message: errorText,
            content: errorText,
            sessionId: payload.sessionId || sessionId || undefined,
          },
        ]);
        updateSseCursor(payload, message);
        return;
      }
      if (message.content || message.metadata) {
        if (!shouldAcceptStreamUpdate(message, payload)) {
          return;
        }
        setMessages((prev) => mergeRealtimeMessage(prev, message, WELCOME_MESSAGE));
      }
      const msgOpencodeSessionId = asText(message.metadata?.opencodeSessionId);
      if (msgOpencodeSessionId) {
        setOpencodeSessionId(msgOpencodeSessionId);
      }
      updateSseCursor(payload, message);
      if (shouldStopProcessingForMessage(message)) {
        setIsProcessing(false);
      }
      return;
    }
    const event = toRecord(payload.event);
    if (!event || Object.keys(event).length === 0) return;

    const eventType = asText(event.type) || asText(payload.eventType) || 'unknown';
    const stream = extractStreamContent(eventType, event);
    const opencodeSessionId = asText(payload.opencodeSessionId) || findSessionId(event) || '';
    if (opencodeSessionId) {
      setOpencodeSessionId(opencodeSessionId);
    }
    const payloadMetadata = toRecord(payload.metadata);

    const metadata: Record<string, unknown> = {
      eventType,
      event,
      rawPayload: { event },
      opencodeSessionId: opencodeSessionId || undefined,
      seq: asFiniteNumber(payloadMetadata.seq) ?? asFiniteNumber(payload.seq) ?? undefined,
      timestamp:
        asFiniteNumber(payloadMetadata.timestamp) ??
        asFiniteNumber(payload.createdAt) ??
        undefined,
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
      content = '';
    }

    const message: AgentMessage = {
      type: 'opencode_event',
      content,
      metadata,
      sessionId: sessionId || undefined,
    };

    if (shouldAcceptStreamUpdate(message, payload)) {
      setMessages((prev) => mergeRealtimeMessage(prev, message, WELCOME_MESSAGE));
    }
    updateSseCursor(payload, message);
    if (shouldStopProcessingForMessage(message)) {
      setIsProcessing(false);
    }
  }, [sessionId, WELCOME_MESSAGE]);

  const openSse = useCallback(
    (targetSessionId: string, targetOpencodeSessionId?: string) => {
      const altusMode = readAltusMode();
      const streamOpencodeSessionId =
        altusMode === 'sandbox' ? undefined : targetOpencodeSessionId || undefined;
      const sinceCursor =
        sseCursorKindRef.current === 'seq' && sseCursorRef.current > 0
          ? sseCursorRef.current
          : undefined;
      const url = getOpencodeEventStreamUrl(
        targetSessionId,
        streamOpencodeSessionId,
        sinceCursor,
        sseClientIdRef.current
      );
      closeSse();
      const source = new EventSource(url);
      sseRef.current = source;

      source.onopen = () => {
        ssePreferredRef.current = true;
        sseActiveRef.current = true;
        sseLastAtRef.current = Date.now();
        sseReconnectAttemptRef.current = 0;
        clearSseReconnectTimer();
      };

      source.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (event.lastEventId) {
            const parsedId = Number(event.lastEventId);
            if (Number.isFinite(parsedId) && parsedId > 0) {
              const nextKind = parsedId >= 1_000_000_000_000 ? 'timestamp' : 'seq';
              if (nextKind === 'seq') {
                if (sseCursorKindRef.current !== 'seq' || parsedId > sseCursorRef.current) {
                  sseCursorRef.current = parsedId;
                  sseCursorKindRef.current = 'seq';
                }
              } else if (sseCursorKindRef.current !== 'seq' && parsedId > sseCursorRef.current) {
                sseCursorRef.current = parsedId;
                sseCursorKindRef.current = 'timestamp';
              }
            }
          }
          sseLastAtRef.current = Date.now();
          handleSsePayload(payload);
        } catch (error) {
          console.warn('[TaskCreationAgent] SSE 解析失败:', error);
        }
      };

      source.addEventListener('ready', (event: MessageEvent) => {
        try {
          const payload = JSON.parse(event.data);
          if (event.lastEventId) {
            const parsedId = Number(event.lastEventId);
            if (Number.isFinite(parsedId) && parsedId > 0) {
              const nextKind = parsedId >= 1_000_000_000_000 ? 'timestamp' : 'seq';
              if (nextKind === 'seq') {
                if (sseCursorKindRef.current !== 'seq' || parsedId > sseCursorRef.current) {
                  sseCursorRef.current = parsedId;
                  sseCursorKindRef.current = 'seq';
                }
              } else if (sseCursorKindRef.current !== 'seq' && parsedId > sseCursorRef.current) {
                sseCursorRef.current = parsedId;
                sseCursorKindRef.current = 'timestamp';
              }
            }
          }
          sseLastAtRef.current = Date.now();
          handleSsePayload(payload);
        } catch {
          // ignore ready parse errors
        }
      });

      source.addEventListener('bridge', (event: MessageEvent) => {
        try {
          const payload = JSON.parse(event.data || '{}');
          if (payload && typeof payload === 'object') {
            sseBridgeStateRef.current = {
              reconnecting: payload.reconnecting === true,
              connectedAt: typeof payload.connectedAt === 'string' ? payload.connectedAt : undefined,
              disconnectedAt: typeof payload.disconnectedAt === 'string' ? payload.disconnectedAt : undefined,
            };
            if (payload.reconnecting === true) {
              setSseReplayHint((value) => value + 1);
            }
          }
        } catch {
          // ignore bridge marker parse errors
        }
      });

      source.onerror = () => {
        ssePreferredRef.current = false;
        sseActiveRef.current = false;
        sseLastAtRef.current = 0;
        void refreshRuntimeStatus(targetSessionId);
        scheduleSseReconnect(targetSessionId);
      };
    },
    [closeSse, handleSsePayload, refreshRuntimeStatus, scheduleSseReconnect, clearSseReconnectTimer]
  );

  useEffect(() => {
    openSseRef.current = openSse;
  }, [openSse]);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const scheduleReconnect = useCallback(() => {
    if (reconnectingRef.current) return;
    reconnectingRef.current = true;
    clearReconnectTimer();
    const attempt = Math.min(reconnectAttemptRef.current + 1, 6);
    reconnectAttemptRef.current = attempt;
    const delayMs = Math.min(30000, 1000 * Math.pow(2, attempt));
    reconnectTimerRef.current = window.setTimeout(() => {
      reconnectingRef.current = false;
      connectRef.current();
    }, delayMs);
  }, [clearReconnectTimer]);

  const sendOrQueueMessage = useCallback((payload: Record<string, unknown>) => {
    const serialized = JSON.stringify(payload);
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(serialized);
      return true;
    }
    outboundQueueRef.current.push(serialized);
    connectRef.current();
    return false;
  }, []);

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
      reconnectAttemptRef.current = 0;
      reconnectingRef.current = false;
      clearReconnectTimer();
      setIsConnected(true);
      if (outboundQueueRef.current.length > 0) {
        const queued = outboundQueueRef.current.splice(0);
        for (const item of queued) {
          if (ws.readyState !== WebSocket.OPEN) {
            outboundQueueRef.current.unshift(item);
            break;
          }
          ws.send(item);
        }
      }
    };

    ws.onmessage = (event) => {
      try {
        const message: AgentMessage = JSON.parse(event.data);
        console.log('[TaskCreationAgent] 收到消息:', message);
        const altusMode = readAltusMode();
        if (message.type === 'error') {
          const errorText = (message.message || message.content || '请求失败，请稍后重试').trim();
          setIsProcessing(false);
          setMessages((prev) => [
            ...prev,
            {
              type: 'error',
              message: errorText,
              content: errorText,
              sessionId: message.sessionId || sessionId || undefined,
            },
          ]);
          return;
        }
        // 直通模式下屏蔽 Altus 欢迎语，避免污染 OpenCode 直通会话体验。
        if (altusMode === 'sandbox' && message.type === 'agent_message' && message.content === WELCOME_MESSAGE) {
          return;
        }
        if (message.type === 'opencode_event' && ssePreferredRef.current) {
          return;
        }
        const messageSessionId = message.sessionId || message.metadata?.sessionId;
        if (messageSessionId) {
          bindSessionId(messageSessionId);

          if (startRuntimeOnNextSessionRef.current && autoRuntime) {
            startRuntimeOnNextSessionRef.current = false;
            void ensureRuntimeRef.current();
          }
          try {
            window.dispatchEvent(
              new CustomEvent('task-creation-session-updated', {
                detail: { sessionId: messageSessionId },
              })
            );
          } catch {
            // ignore dispatch failures
          }
        }
        const orchestratorId = extractOrchestratorSessionId(message);
        if (orchestratorId) {
          setOrchestratorSessionId(orchestratorId);
          setRuntimeStatus('ready');
        }
        const opencodeId = asText(message.metadata?.opencodeSessionId);
        if (opencodeId) {
          setOpencodeSessionId(opencodeId);
        }

        setMessages((prev) => mergeRealtimeMessage(prev, message, WELCOME_MESSAGE));
        if (shouldStopProcessingForMessage(message)) {
          setIsProcessing(false);
        }

        switch (message.type) {
          case 'agent_message':
          case 'status_update':
            // 显示 Agent 消息
            break;

          case 'clarification_request':
            // 显示澄清问题
            if (message.question) {
              setCurrentQuestion({
                question: message.question,
                options: message.options,
              });
            }
            break;

          case 'plan_generated':
            // 计划生成完成
            if (message.plan && onPlanGeneratedRef.current) {
              onPlanGeneratedRef.current(message.plan);
            }
            break;

          case 'opencode_event':
            // OpenCode 运行时事件已通过 shouldStopProcessingForMessage 统一处理收敛。
            break;

        }
      } catch (error) {
        console.error('[TaskCreationAgent] 解析消息失败:', error);
      }
    };

    ws.onerror = (error) => {
      console.error('[TaskCreationAgent] WebSocket 错误:', error);
      setIsConnected(false);
      scheduleReconnect();
    };

    ws.onclose = () => {
      console.log('[TaskCreationAgent] WebSocket 连接关闭');
      setIsConnected(false);
      scheduleReconnect();
    };

    wsRef.current = ws;
  }, [autoRuntime, bindSessionId, clearReconnectTimer, scheduleReconnect]);

  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  // 断开连接
  const disconnect = useCallback(() => {
    clearReconnectTimer();
    reconnectAttemptRef.current = 0;
    reconnectingRef.current = false;
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setIsConnected(false);
  }, [clearReconnectTimer]);

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
        const sa = asPositiveInt(toRecord(a?.metadata).sessionEventSeq);
        const sb = asPositiveInt(toRecord(b?.metadata).sessionEventSeq);
        if (sa !== null && sb !== null && sa !== sb) {
          return sa - sb;
        }
        if (sa !== null && sb === null) return -1;
        if (sa === null && sb !== null) return 1;
        const ta = a?.createdAt ? Date.parse(a.createdAt) : NaN;
        const tb = b?.createdAt ? Date.parse(b.createdAt) : NaN;
        if (Number.isNaN(ta) || Number.isNaN(tb)) return 0;
        return ta - tb;
      });
      sseStreamClockRef.current.clear();
      sseStreamSeqRef.current.clear();
      sseStreamLengthRef.current.clear();
      sseStreamSignatureRef.current.clear();
      for (const item of ordered) {
        if (item?.messageType !== 'opencode_event') continue;
        const meta = toRecord(item.metadata);
        if (!isTextStreamEvent(meta, item.content)) continue;
        const streamKey = resolveTextStreamKeyFromMetadata(meta);
        if (!streamKey) continue;
        const seq = asFiniteNumber(meta.seq);
        if (seq !== null) {
          const prevSeq = sseStreamSeqRef.current.get(streamKey);
          if (typeof prevSeq !== 'number' || seq > prevSeq) {
            sseStreamSeqRef.current.set(streamKey, seq);
          }
        }
        const ts =
          asFiniteNumber(meta.timestamp) ??
          (item?.createdAt ? Date.parse(item.createdAt) : 0);
        if (Number.isFinite(ts) && ts) {
          const prevTs = sseStreamClockRef.current.get(streamKey) || 0;
          if (ts > prevTs) {
            sseStreamClockRef.current.set(streamKey, ts);
          }
        }
        const len = (item?.content || '').length;
        const prevLen = sseStreamLengthRef.current.get(streamKey) || 0;
        if (len > prevLen) {
          sseStreamLengthRef.current.set(streamKey, len);
        }
        const signature = `${seq ?? 'na'}:${ts || 'na'}:${item?.content || ''}`;
        if (signature !== 'na:na:') {
          sseStreamSignatureRef.current.set(streamKey, signature);
        }
      }
      let latestSeqCursor = 0;
      let latestTimestampCursor = 0;
      for (const item of ordered) {
        if (item?.messageType !== 'opencode_event') continue;
        const meta = toRecord(item.metadata);
        const seq = asFiniteNumber(meta.seq);
        if (seq !== null && seq > latestSeqCursor) {
          latestSeqCursor = seq;
        }
        const ts =
          asFiniteNumber(meta.timestamp) ??
          (item?.createdAt ? Date.parse(item.createdAt) : 0);
        if (Number.isFinite(ts) && ts > latestTimestampCursor) {
          latestTimestampCursor = ts;
        }
      }
      if (latestSeqCursor > 0) {
        sseCursorRef.current = latestSeqCursor;
        sseCursorKindRef.current = 'seq';
      } else if (latestTimestampCursor > 0) {
        sseCursorRef.current = latestTimestampCursor;
        sseCursorKindRef.current = 'timestamp';
      }
      const sourceList = compactHistory ? compactHistoryMessages(ordered) : ordered;
      const mapped = sourceList.map((item: any) => {
        const metadata = item?.metadata || {};
        const messageType = item?.messageType;
        const role = item?.role;

        if (messageType === 'session_started') {
          return null;
        }
        if (messageType === 'opencode_agent_input') {
          return null;
        }
        if (messageType === 'opencode_user_input') {
          return {
            type: 'user_input',
            content: item?.content || '',
            sessionId: historySessionId,
            metadata,
          };
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
          const content = item?.content || '';
          const normalized = content.trim();
          const inferredStage =
            normalized.includes('OpenCode 执行完成')
              ? 'completed'
              : normalized.includes('OpenCode 执行失败') || normalized.includes('OpenCode 执行已结束')
                ? 'failed'
                : 'executing';
          return {
            type: 'status_update',
            content,
            stage: inferredStage,
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
      const normalized =
        compactHistory
          ? filtered
          : filtered.reduce<AgentMessage[]>(
              (acc, item) => mergeRealtimeMessage(acc, item, WELCOME_MESSAGE),
              []
            );
      setMessages(normalized);

      const lastClarificationIndex = [...normalized]
        .map((msg, index) => ({ msg, index }))
        .filter(({ msg }) => msg.type === 'clarification_request')
        .map(({ index }) => index)
        .pop();
      if (lastClarificationIndex !== undefined) {
        const hasUserResponseAfter = normalized
          .slice(lastClarificationIndex + 1)
          .some((msg) => msg.type === 'user_response');
        if (!hasUserResponseAfter) {
          const clarification = normalized[lastClarificationIndex];
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

      const latestRuntimeSession = [...normalized]
        .reverse()
        .map((msg) => extractOrchestratorSessionId(msg))
        .find((value): value is string => Boolean(value));
      const latestOpencodeSession = [...normalized]
        .reverse()
        .map((msg) => asText(toRecord(msg.metadata).opencodeSessionId))
        .find((value): value is string => Boolean(value));
      if (latestRuntimeSession) {
        setOrchestratorSessionId(latestRuntimeSession);
        setRuntimeStatus('ready');
        if (latestOpencodeSession) {
          setOpencodeSessionId(latestOpencodeSession);
        }
      } else {
        setOrchestratorSessionId(null);
        setOpencodeSessionId(null);
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
    if (sessionId) {
      void loadHistory(sessionId);
    }
  }, [sessionId, loadHistory]);

  useEffect(() => {
    if (!sessionId || sseReplayHint <= 0) {
      return;
    }
    void loadHistory(sessionId);
  }, [sseReplayHint, sessionId, loadHistory]);

  useEffect(() => {
    if (sessionId) {
      void refreshRuntimeStatus(sessionId);
    }
  }, [sessionId, refreshRuntimeStatus]);

  useEffect(() => {
    sseCursorRef.current = 0;
    sseCursorKindRef.current = null;
    sseStreamSeqRef.current.clear();
    sseStreamClockRef.current.clear();
    sseStreamLengthRef.current.clear();
    sseStreamSignatureRef.current.clear();
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId || !orchestratorSessionId || !runtimeEnabled) {
      closeSse();
      clearSseReconnectTimer();
      ssePreferredRef.current = false;
      return;
    }
    openSse(sessionId, opencodeSessionId || undefined);
    return () => {
      closeSse();
      clearSseReconnectTimer();
      ssePreferredRef.current = false;
    };
  }, [
    sessionId,
    orchestratorSessionId,
    opencodeSessionId,
    runtimeEnabled,
    openSse,
    closeSse,
    clearSseReconnectTimer,
  ]);

  // SSE 停滞检测：仅用于重连 SSE，不做 WS 降级
  useEffect(() => {
    if (!sessionId || !runtimeEnabled) return;
    const intervalMs = 5000;
    const staleMs = 20000;
    const timer = window.setInterval(() => {
      if (!ssePreferredRef.current) return;
      if (!sseActiveRef.current) return;
      const lastAt = sseLastAtRef.current;
      if (!lastAt) return;
      if (Date.now() - lastAt >= staleMs) {
        closeSse();
        scheduleSseReconnect(sessionId);
      }
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [sessionId, runtimeEnabled, closeSse, scheduleSseReconnect]);

  // 发送用户输入
  const sendUserInput = useCallback((input: string, options?: SendInputOptions) => {
    const targetSessionId = (options?.sessionId || sessionId || '').trim() || undefined;
    startRuntimeOnNextSessionRef.current = true;
    if (autoRuntime && runtimeEnabled && targetSessionId && !runtimeReady && !runtimeStarting) {
      void ensureRuntime();
    }

    setIsProcessing(true);
    setCurrentQuestion(null);
    setMessages((prev) => [
      ...prev,
      {
        type: 'user_input',
        content: input,
        metadata: options?.metadata,
        sessionId: targetSessionId,
      },
    ]);

    sendOrQueueMessage({
      type: 'user_input',
      content: input,
      sessionId: targetSessionId,
      metadata: {
        ...(options?.metadata || {}),
        altusMode: 'managed',
        executor: readExecutor(),
      },
    });
  }, [autoRuntime, runtimeEnabled, runtimeReady, runtimeStarting, ensureRuntime, sendOrQueueMessage, sessionId]);

  const sendChatInput = useCallback(async (input: string, options?: SendInputOptions) => {
    const text = input.trim();
    if (!text) return;

    let activeSessionId = (() => {
      if (options?.sessionId) return options.sessionId;
      if (sessionId) return sessionId;
      const pathMatch = location.match(/^\/session\/([^/?#]+)/);
      const pathSessionId = pathMatch ? decodeURIComponent(pathMatch[1]) : '';
      if (pathSessionId) return pathSessionId;
      try {
        const stored = window.localStorage.getItem(SESSION_STORAGE_KEY);
        return stored && stored.trim() ? stored.trim() : '';
      } catch {
        return '';
      }
    })();
    if (activeSessionId && activeSessionId !== sessionId) {
      bindSessionId(activeSessionId);
    }

    const altusMode = readAltusMode();
    if (altusMode === 'sandbox') {
      if (!activeSessionId) {
        const provisionalId =
          (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : `session_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`);
        activeSessionId = provisionalId;
        bindSessionId(provisionalId);
      }
      let prePersistedUserInput = false;
      if (activeSessionId) {
        try {
          await createTaskCreationSession({
            sessionId: activeSessionId,
            title: text.slice(0, 80),
            mode: 'sandbox',
            executor: readExecutor(),
            initialMessage: text,
            initialMessageType: 'user_input',
          });
          prePersistedUserInput = true;
          try {
            window.dispatchEvent(
              new CustomEvent('task-creation-session-updated', {
                detail: { sessionId: activeSessionId },
              })
            );
          } catch {
            // ignore dispatch failures
          }
        } catch (error) {
          console.warn('[TaskCreationAgent] 预创建会话失败，继续走 WS 发送:', error);
        }
      }
      // 直通模式：直接发送给后端的 opencode_input，后端仅负责桥接与落盘，
      // 不触发 Altus 编排（澄清/规划/执行计划等）。
      setIsProcessing(true);
      setCurrentQuestion(null);
      setMessages((prev) => [
        ...prev,
        {
          type: 'user_input',
          content: text,
          metadata: options?.metadata,
          sessionId: activeSessionId || undefined,
        },
      ]);
      const orchestratorId = (orchestratorSessionId || '').trim();
      sendOrQueueMessage({
        type: 'opencode_input',
        content: text,
        sessionId: activeSessionId || undefined,
        metadata: {
          ...(options?.metadata || {}),
          ...(orchestratorId ? { orchestratorSessionId: orchestratorId } : undefined),
          ...(opencodeSessionId ? { opencodeSessionId } : undefined),
          altusMode: 'sandbox',
          executor: readExecutor(),
          ...(prePersistedUserInput ? { prePersistedUserInput: true } : undefined),
        },
      });
      if (activeSessionId) {
        window.setTimeout(() => {
          void refreshRuntimeStatus(activeSessionId);
        }, 400);
      }
      return;
    }

    sendUserInput(text, {
      ...options,
      sessionId: activeSessionId || options?.sessionId || undefined,
    });
  }, [
    bindSessionId,
    location,
    orchestratorSessionId,
    opencodeSessionId,
    refreshRuntimeStatus,
    sendOrQueueMessage,
    sendUserInput,
    sessionId,
  ]);

  const ensureSession = useCallback(async (title?: string) => {
    const existing = (sessionId || '').trim();
    if (existing) return existing;
    const created = await createTaskCreationDraftSession(title);
    const nextSessionId = (created.id || '').trim();
    if (!nextSessionId) {
      throw new Error('draft session id missing');
    }
    bindSessionId(nextSessionId);
    return nextSessionId;
  }, [bindSessionId, sessionId]);

  return {
    isConnected,
    isProcessing,
    messages,
    sessionId,
    currentQuestion,
    runtime: {
      orchestratorSessionId,
      opencodeSessionId,
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
    ensureSession,
    answerQuestion,
    clearMessages,
    connect,
    disconnect,
  };
}
