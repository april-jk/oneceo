/**
 * Debug Todo Service
 *
 * 提供调试专用的子 todo 生成、管理和文档查询功能。
 * 当 Altus Managed Run 触发调试流程时，通过此服务：
 * 1. 生成结构化的调试 todo（测试单元清单）
 * 2. 基于 todo 逐项执行测试
 * 3. 查找功能点时先查阅项目文档了解规范
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

// ============================================================================
// 类型定义
// ============================================================================

/** 调试 todo 单项 */
export interface DebugTodoItem {
  /** 测试单元标识 */
  id: string;
  /** 测试单元名称（具体到接口/函数/页面动作/Redis key/DB 表） */
  testUnit: string;
  /** 测试单元类型 */
  unitType: 'interface' | 'function' | 'page_action' | 'redis_key' | 'db_table' | 'external_dependency' | 'document_check';
  /** 预期输入 */
  expectedInput: string;
  /** 预期输出 */
  expectedOutput: string;
  /** 边界条件 */
  boundaryConditions: string;
  /** 验证方式 */
  verificationMethod: string;
  /** 执行状态 */
  status: 'pending' | 'in_progress' | 'passed' | 'failed' | 'skipped';
  /** 实际结果记录 */
  actualResult?: string;
  /** 备注 */
  notes?: string;
  /** 最近一次关联工具 */
  latestToolName?: 'debug_open_page' | 'browser_interact';
  /** 最近一次浏览器动作 */
  latestAction?: string;
  /** 最近一次截图证据摘要 */
  latestScreenshot?: DebugTodoScreenshotSummary;
}

export interface DebugTodoScreenshotSummary {
  status: 'captured' | 'capture_failed' | 'storage_failed';
  storageKey?: string;
  capturedAt?: string;
  visualStatus?: 'passed' | 'failed';
  reasonCode?: string;
  message?: string;
}

export interface DebugTodoLink {
  status: 'linked' | 'unmatched' | 'no_active_todo';
  itemId?: string;
  itemStatus?: DebugTodoItem['status'];
  testUnit?: string;
  unitType?: DebugTodoItem['unitType'];
  actualResult?: string;
  reasonCode?: string;
  message?: string;
}

export interface BrowserDebugEvidenceSummary {
  status?: string;
  storageKey?: string;
  capturedAt?: string;
  reasonCode?: string;
  message?: string;
  visualCheck?: {
    status?: string;
    reasonCode?: string;
    message?: string;
  };
  source?: {
    action?: string;
    description?: string;
    url?: string;
  };
}

/** 调试 todo 完整结构 */
export interface DebugTodo {
  /** 调试会话标识 */
  sessionId: string;
  /** 关联的 runId */
  runId?: string;
  /** 触发原因 */
  triggerReason: string;
  /** 调试深度 */
  debugDepth: 'interface_only' | 'real_link' | 'storage_verification' | 'full_link';
  /** 关联的已采用文档 */
  relatedDocument?: string;
  /** 测试单元清单 */
  items: DebugTodoItem[];
  /** 创建时间 */
  createdAt: string;
  /** 更新时间 */
  updatedAt: string;
  /** 整体状态 */
  overallStatus: 'draft' | 'in_progress' | 'completed' | 'failed';
  /** 结论分类 */
  conclusion?: {
    passed: string[];
    inconsistent: string[];
    missing: string[];
    unverifiable: string[];
  };
}

/** 文档查询结果 */
export interface DocQueryResult {
  /** 文档路径 */
  docPath: string;
  /** 文档标题/描述 */
  docTitle: string;
  /** 相关章节摘要 */
  relevantSections: string[];
  /** 关键操作规范 */
  keyGuidelines: string[];
}

/** 项目文档索引项 */
interface ProjectDocEntry {
  path: string;
  title: string;
  module: string;
  keywords: string[];
}

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const STATIC_REPO_ROOT_CANDIDATE = path.resolve(MODULE_DIR, '..', '..', '..', '..');

function isRepositoryRoot(candidate: string): boolean {
  return existsSync(path.join(candidate, 'AGENTS.md')) && existsSync(path.join(candidate, 'docs'));
}

function resolveProjectDocRoot(): string {
  const envRoot = process.env.ONECEO_REPO_ROOT || process.env.ONECEO_PROJECT_ROOT;
  const candidates = [
    envRoot,
    process.cwd(),
    path.resolve(process.cwd(), '..'),
    path.resolve(process.cwd(), '..', '..'),
    STATIC_REPO_ROOT_CANDIDATE,
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    const normalized = path.resolve(candidate);
    if (isRepositoryRoot(normalized)) {
      return normalized;
    }
  }

  return STATIC_REPO_ROOT_CANDIDATE;
}

function resolveProjectDocPath(docPath: string): string | null {
  const normalizedDocPath = docPath.trim();
  if (!normalizedDocPath || path.isAbsolute(normalizedDocPath)) {
    return null;
  }

  const root = resolveProjectDocRoot();
  const fullPath = path.resolve(root, normalizedDocPath);
  const relative = path.relative(root, fullPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return null;
  }

  return fullPath;
}

// ============================================================================
// 项目文档索引（硬编码的关键文档映射）
// ============================================================================

const PROJECT_DOC_INDEX: ProjectDocEntry[] = [
  {
    path: 'AGENTS.md',
    title: 'Agent 协作入口与全局规范',
    module: 'global',
    keywords: ['规范', '必读', '协作', 'git', 'E2B', 'OSAC', 'LLM', 'Redis', '鉴权'],
  },
  {
    path: 'docs/AGENTS_GUIDE/agent-code-locations.md',
    title: '代码位置速查表',
    module: 'code-location',
    keywords: ['代码位置', '文件', '路由', 'service', '入口', '在哪里'],
  },
  {
    path: 'docs/AGENTS_GUIDE/AGENT_CODE_MODIFICATION_GUIDE.md',
    title: '代码修改快速指南',
    module: 'code-modification',
    keywords: ['修改', '编辑', '修复', '怎么改', '如何改'],
  },
  {
    path: 'docs/AGENTS_GUIDE/05_系统调试与测试指南.md',
    title: '系统调试与测试指南',
    module: 'debug-test',
    keywords: ['调试', '测试', '验证', '检查', '验收', '测试单元'],
  },
  {
    path: 'DESIGN.md',
    title: 'UI/UX 设计系统',
    module: 'design',
    keywords: ['设计', 'UI', 'UX', '样式', '颜色', '字体', '组件'],
  },
  {
    path: 'PRODUCT.md',
    title: '产品定义',
    module: 'product',
    keywords: ['产品', '功能', '范围', '需求'],
  },
  {
    path: 'docs/AGENTS_GUIDE/03_sandbox_e2b.md',
    title: 'Sandbox E2B 指南',
    module: 'sandbox',
    keywords: ['sandbox', 'E2B', '浏览器', '调试浏览器', 'neko'],
  },
  {
    path: 'docs/AGENTS_GUIDE/04_agent_flow.md',
    title: 'Agent 流程指南',
    module: 'agent-flow',
    keywords: ['Agent', '意图识别', '规划', '执行', '任务创建'],
  },
];

// ============================================================================
// Debug Todo 生成
// ============================================================================

/**
 * 根据触发原因和上下文生成调试 todo 模板
 */
export function generateDebugTodo(input: {
  sessionId: string;
  runId?: string;
  triggerReason: string;
  debugDepth?: DebugTodo['debugDepth'];
  relatedDocument?: string;
}): DebugTodo {
  const now = new Date().toISOString();

  // 根据触发原因生成默认的测试单元
  const defaultItems = buildDefaultDebugItems(input.triggerReason);

  return {
    sessionId: input.sessionId,
    runId: input.runId,
    triggerReason: input.triggerReason,
    debugDepth: input.debugDepth || 'real_link',
    relatedDocument: input.relatedDocument,
    items: defaultItems,
    createdAt: now,
    updatedAt: now,
    overallStatus: 'draft',
  };
}

function buildDefaultDebugItems(triggerReason: string): DebugTodoItem[] {
  const items: DebugTodoItem[] = [
    {
      id: 'debug-001',
      testUnit: '确认测试依据和已采用文档',
      unitType: 'document_check',
      expectedInput: '找到对应功能的最新的 [yyyymmdd-hhmm已采用] 设计文档',
      expectedOutput: '明确测试依据：已采用文档名称、版本、相关章节',
      boundaryConditions: '无已采用文档时以现有实现契约为准',
      verificationMethod: '读取并确认文档存在且状态正确',
      status: 'pending',
    },
    {
      id: 'debug-002',
      testUnit: '明确调试深度和范围',
      unitType: 'document_check',
      expectedInput: '确定本次调试只做接口测试 / 真实链路 / 存储核验 / 全链路',
      expectedOutput: '明确的调试深度声明',
      boundaryConditions: '禁止在底层状态未核验时进入全链路测试',
      verificationMethod: '记录调试深度到 todo',
      status: 'pending',
    },
    {
      id: 'debug-003',
      testUnit: '导出最小测试单元清单',
      unitType: 'document_check',
      expectedInput: '将调试目标拆分为最小可验证模块',
      expectedOutput: '具体的接口/函数/页面动作/Redis key/DB 表清单',
      boundaryConditions: '禁止写"测试聊天功能"这种大项',
      verificationMethod: '清单粒度是否足够小（可具体到单一接口或函数）',
      status: 'pending',
    },
  ];

  // 根据触发原因添加针对性的测试单元
  const lowerReason = triggerReason.toLowerCase();

  if (lowerReason.includes('浏览器') || lowerReason.includes('debug') || lowerReason.includes('页面')) {
    items.push(
      {
        id: 'debug-004-web',
        testUnit: '验证页面可访问性和基本渲染',
        unitType: 'page_action',
        expectedInput: '调用 debug_open_page 打开目标页面',
        expectedOutput: '页面成功加载，返回 200，截图显示正确内容',
        boundaryConditions: '服务未启动时需先启动；独立 HTML 使用 file:// URL',
        verificationMethod: 'debug_open_page 工具结果 + Playwright 截图',
        status: 'pending',
      },
      {
        id: 'debug-005-web',
        testUnit: '验证核心交互和控件',
        unitType: 'page_action',
        expectedInput: '使用 browser_interact 执行点击、填写、滚动等操作',
        expectedOutput: '交互后页面状态正确，截图证据清晰',
        boundaryConditions: '只对可见控件执行交互；不支持的操作不强行执行',
        verificationMethod: 'browser_interact 工具结果 + 截图对比',
        status: 'pending',
      }
    );
  }

  if (lowerReason.includes('接口') || lowerReason.includes('api') || lowerReason.includes('路由')) {
    items.push(
      {
        id: 'debug-004-api',
        testUnit: '验证成功路径',
        unitType: 'interface',
        expectedInput: '正确的请求参数和鉴权信息',
        expectedOutput: 'HTTP 200 + 符合预期的响应体',
        boundaryConditions: '输入参数边界值测试',
        verificationMethod: 'curl 或等效工具调用，检查响应体内容',
        status: 'pending',
      },
      {
        id: 'debug-005-api',
        testUnit: '验证鉴权失败和越权访问',
        unitType: 'interface',
        expectedInput: '未登录 / 错误 token / 其他用户资源',
        expectedOutput: '401/403 错误，不返回敏感数据',
        boundaryConditions: '用户态和管理态必须分离验证',
        verificationMethod: '使用错误凭据调用接口',
        status: 'pending',
      }
    );
  }

  if (lowerReason.includes('数据库') || lowerReason.includes('db') || lowerReason.includes('存储')) {
    items.push(
      {
        id: 'debug-004-db',
        testUnit: '验证数据正确落盘',
        unitType: 'db_table',
        expectedInput: '执行相关功能后',
        expectedOutput: '数据库中对应表有正确记录，归属字段正确',
        boundaryConditions: '并发写入、更新覆盖范围',
        verificationMethod: '直接 SQL 查询验证',
        status: 'pending',
      }
    );
  }

  if (lowerReason.includes('redis') || lowerReason.includes('缓存')) {
    items.push(
      {
        id: 'debug-004-redis',
        testUnit: '验证 Redis 键值正确写入',
        unitType: 'redis_key',
        expectedInput: '执行相关功能后',
        expectedOutput: 'Redis 中对应 key/stream 已按预期写入，TTL 生效',
        boundaryConditions: '开关关闭时不启用；开关打开后真实写入',
        verificationMethod: 'redis-cli 或直接查询验证',
        status: 'pending',
      }
    );
  }

  // 通用收尾项
  items.push(
    {
      id: 'debug-final',
      testUnit: '输出调试结论',
      unitType: 'document_check',
      expectedInput: '所有测试单元执行完毕',
      expectedOutput: '四类结论：已按设计通过 / 已实现但不一致 / 设计存在但实现缺失 / 当前无法验证',
      boundaryConditions: '禁止只输出"已测试通过"而没有证据链',
      verificationMethod: '逐项核对并分类记录',
      status: 'pending',
    }
  );

  return items;
}

// ============================================================================
// Debug Todo 状态管理（内存存储，按 sessionId 索引）
// ============================================================================

const debugTodoStore = new Map<string, DebugTodo>();

export function saveDebugTodo(todo: DebugTodo): void {
  debugTodoStore.set(todo.sessionId, { ...todo, updatedAt: new Date().toISOString() });
}

export function getDebugTodo(sessionId: string): DebugTodo | undefined {
  return debugTodoStore.get(sessionId);
}

export function updateDebugTodoItem(
  sessionId: string,
  itemId: string,
  updates: Partial<Omit<DebugTodoItem, 'id'>>
): DebugTodo | undefined {
  const todo = debugTodoStore.get(sessionId);
  if (!todo) return undefined;

  const updatedItems = todo.items.map((item) =>
    item.id === itemId ? { ...item, ...updates } : item
  );

  const updatedTodo: DebugTodo = {
    ...todo,
    items: updatedItems,
    updatedAt: new Date().toISOString(),
  };

  debugTodoStore.set(sessionId, updatedTodo);
  return updatedTodo;
}

export function setDebugTodoOverallStatus(
  sessionId: string,
  status: DebugTodo['overallStatus']
): DebugTodo | undefined {
  const todo = debugTodoStore.get(sessionId);
  if (!todo) return undefined;

  const updated: DebugTodo = {
    ...todo,
    overallStatus: status,
    updatedAt: new Date().toISOString(),
  };

  debugTodoStore.set(sessionId, updated);
  return updated;
}

function resolveDebugTodoItem(todo: DebugTodo, itemId?: string): DebugTodoItem | undefined {
  const normalizedItemId = typeof itemId === 'string' ? itemId.trim() : '';
  if (normalizedItemId) {
    return todo.items.find((item) => item.id === normalizedItemId);
  }

  return (
    todo.items.find((item) => item.status === 'pending' && item.unitType === 'page_action') ||
    todo.items.find((item) => item.status === 'pending') ||
    todo.items.find((item) => item.unitType === 'page_action')
  );
}

function summarizeBrowserDebugEvidence(evidence: BrowserDebugEvidenceSummary): {
  itemStatus: DebugTodoItem['status'];
  actualResult: string;
  screenshot: DebugTodoScreenshotSummary;
} {
  const screenshotStatus = evidence.status;
  const visualStatus = evidence.visualCheck?.status;
  const passed = screenshotStatus === 'captured' && visualStatus === 'passed';
  const reasonCode = evidence.visualCheck?.reasonCode || evidence.reasonCode;
  const message = evidence.visualCheck?.message || evidence.message;
  const description = evidence.source?.description || evidence.source?.action || '浏览器调试动作';
  const actualResult = passed
    ? `${description} 已通过，截图已捕获并通过视觉诊断。`
    : `${description} 未通过：${message || reasonCode || screenshotStatus || '未获得有效截图证据'}`;

  return {
    itemStatus: passed ? 'passed' : 'failed',
    actualResult,
    screenshot: {
      status:
        screenshotStatus === 'captured' || screenshotStatus === 'capture_failed' || screenshotStatus === 'storage_failed'
          ? screenshotStatus
          : 'capture_failed',
      storageKey: evidence.storageKey,
      capturedAt: evidence.capturedAt,
      visualStatus: visualStatus === 'passed' || visualStatus === 'failed' ? visualStatus : undefined,
      reasonCode,
      message,
    },
  };
}

export function linkDebugTodoBrowserEvidence(input: {
  sessionId: string;
  itemId?: string;
  toolName: 'debug_open_page' | 'browser_interact';
  evidence: BrowserDebugEvidenceSummary;
}): DebugTodoLink {
  const todo = debugTodoStore.get(input.sessionId);
  if (!todo) {
    return {
      status: 'no_active_todo',
      reasonCode: 'debug_todo_not_found',
      message: '当前 run 未找到调试专用 todo。',
    };
  }

  const item = resolveDebugTodoItem(todo, input.itemId);
  if (!item) {
    return {
      status: 'unmatched',
      reasonCode: 'debug_todo_item_not_found',
      message: input.itemId ? `未找到调试子 todo: ${input.itemId}` : '未找到可关联的调试子 todo。',
    };
  }

  if (input.itemId && item.id !== input.itemId) {
    return {
      status: 'unmatched',
      itemId: input.itemId,
      reasonCode: 'debug_todo_item_not_found',
      message: `未找到调试子 todo: ${input.itemId}`,
    };
  }

  const summary = summarizeBrowserDebugEvidence(input.evidence);
  const updated = updateDebugTodoItem(input.sessionId, item.id, {
    status: summary.itemStatus,
    actualResult: summary.actualResult,
    latestToolName: input.toolName,
    latestAction: input.evidence.source?.action,
    latestScreenshot: summary.screenshot,
  });
  const updatedItem = updated?.items.find((candidate) => candidate.id === item.id) || {
    ...item,
    status: summary.itemStatus,
    actualResult: summary.actualResult,
  };

  return {
    status: 'linked',
    itemId: updatedItem.id,
    itemStatus: updatedItem.status,
    testUnit: updatedItem.testUnit,
    unitType: updatedItem.unitType,
    actualResult: updatedItem.actualResult,
    reasonCode: summary.screenshot.reasonCode,
    message: summary.screenshot.message,
  };
}

function summarizeDebugTodoFailureMessage(errorMessage: string): string {
  const compact = errorMessage.replace(/\s+/g, ' ').trim();
  const withoutDiagnostics = compact.split(' diagnostics=')[0] || compact;
  return withoutDiagnostics.slice(0, 320);
}

export function linkDebugTodoToolFailure(input: {
  sessionId: string;
  itemId?: string;
  toolName: 'debug_open_page' | 'browser_interact';
  action?: string;
  description?: string;
  errorMessage: string;
  reasonCode?: string;
}): DebugTodoLink {
  const todo = debugTodoStore.get(input.sessionId);
  const reasonCode = input.reasonCode || 'browser_action_failed';
  const message = summarizeDebugTodoFailureMessage(input.errorMessage);
  if (!todo) {
    return {
      status: 'no_active_todo',
      reasonCode: 'debug_todo_not_found',
      message: '当前 run 未找到调试专用 todo。',
    };
  }

  const item = resolveDebugTodoItem(todo, input.itemId);
  if (!item || (input.itemId && item.id !== input.itemId)) {
    return {
      status: 'unmatched',
      itemId: input.itemId,
      reasonCode: 'debug_todo_item_not_found',
      message: input.itemId ? `未找到调试子 todo: ${input.itemId}` : '未找到可关联的调试子 todo。',
    };
  }

  const description = input.description || input.action || '浏览器调试动作';
  const actualResult = `${description} 未通过：${message || reasonCode}`;
  const updated = updateDebugTodoItem(input.sessionId, item.id, {
    status: 'failed',
    actualResult,
    latestToolName: input.toolName,
    latestAction: input.action,
  });
  const updatedItem = updated?.items.find((candidate) => candidate.id === item.id) || {
    ...item,
    status: 'failed' as const,
    actualResult,
  };

  return {
    status: 'linked',
    itemId: updatedItem.id,
    itemStatus: updatedItem.status,
    testUnit: updatedItem.testUnit,
    unitType: updatedItem.unitType,
    actualResult: updatedItem.actualResult,
    reasonCode,
    message,
  };
}

export function resolveActiveDebugTodoItemId(sessionId: string): string | undefined {
  const todo = debugTodoStore.get(sessionId);
  if (!todo) return undefined;
  return resolveDebugTodoItem(todo)?.id;
}

// ============================================================================
// 文档查询功能
// ============================================================================

/**
 * 根据功能描述查询相关项目文档
 * 返回按相关性排序的文档列表
 */
export function queryProjectDocs(functionDescription: string): DocQueryResult[] {
  const lowerDesc = functionDescription.toLowerCase();
  const results: Array<DocQueryResult & { score: number }> = [];

  for (const doc of PROJECT_DOC_INDEX) {
    let score = 0;
    for (const keyword of doc.keywords) {
      if (lowerDesc.includes(keyword.toLowerCase())) {
        score += 1;
      }
    }
    if (score > 0) {
      results.push({
        docPath: doc.path,
        docTitle: doc.title,
        relevantSections: [doc.module],
        keyGuidelines: [`查阅 ${doc.path} 了解 ${doc.title}`],
        score,
      });
    }
  }

  // 按相关性排序
  results.sort((a, b) => b.score - a.score);

  // 始终包含核心文档
  const hasGlobal = results.some((r) => r.docPath === 'AGENTS.md');
  if (!hasGlobal) {
    results.unshift({
      docPath: 'AGENTS.md',
      docTitle: 'Agent 协作入口与全局规范',
      relevantSections: ['global'],
      keyGuidelines: ['查阅 AGENTS.md 了解全局规范和服务边界'],
      score: 0.5,
    });
  }

  const hasCodeLocation = results.some((r) => r.docPath === 'docs/AGENTS_GUIDE/agent-code-locations.md');
  if (!hasCodeLocation) {
    results.push({
      docPath: 'docs/AGENTS_GUIDE/agent-code-locations.md',
      docTitle: '代码位置速查表',
      relevantSections: ['code-location'],
      keyGuidelines: ['查阅 agent-code-locations.md 定位功能点代码位置'],
      score: 0.3,
    });
  }

  return results.map(({ score: _score, ...rest }) => rest);
}

/**
 * 读取指定文档的部分内容（前 N 行）
 */
export async function readProjectDoc(docPath: string, maxLines = 100): Promise<string> {
  try {
    const fullPath = resolveProjectDocPath(docPath);
    if (!fullPath) {
      return `无法读取文档: ${docPath}`;
    }
    const content = await readFile(fullPath, 'utf-8');
    const lines = content.split('\n');
    return lines.slice(0, maxLines).join('\n');
  } catch {
    return `无法读取文档: ${docPath}`;
  }
}

/**
 * 生成文档查询摘要（用于 prompt 中）
 */
export function buildDocQuerySummary(functionDescription: string): string {
  const docs = queryProjectDocs(functionDescription);

  if (docs.length === 0) {
    return '未找到相关文档，请直接查阅 AGENTS.md 和 docs/AGENTS_GUIDE/agent-code-locations.md';
  }

  const lines = [
    `## 功能点「${functionDescription}」相关文档`,
    '',
    '查找定位该功能点前，请先查阅以下文档了解操作规范：',
    '',
    ...docs.map((doc, i) =>
      `${i + 1}. **${doc.docTitle}** (${doc.docPath})\n   - ${doc.keyGuidelines.join('\n   - ')}`
    ),
    '',
    '查阅完文档后再执行代码搜索和定位。',
  ];

  return lines.join('\n');
}

// ============================================================================
// 调试 Todo 格式化输出
// ============================================================================

/**
 * 将 DebugTodo 格式化为可读文本（用于工具返回结果）
 */
export function formatDebugTodo(todo: DebugTodo): string {
  const lines = [
    `# 调试专用 Todo`,
    '',
    `- 触发原因: ${todo.triggerReason}`,
    `- 调试深度: ${todo.debugDepth}`,
    todo.relatedDocument ? `- 关联文档: ${todo.relatedDocument}` : '',
    `- 整体状态: ${todo.overallStatus}`,
    `- 创建时间: ${todo.createdAt}`,
    '',
    `## 测试单元清单`,
    '',
  ];

  for (const item of todo.items) {
    const statusEmoji =
      item.status === 'passed'
        ? '✅'
        : item.status === 'failed'
          ? '❌'
          : item.status === 'in_progress'
            ? '🔄'
            : item.status === 'skipped'
              ? '⏭️'
              : '⬜';

    lines.push(`### ${statusEmoji} ${item.testUnit} [${item.id}]`);
    lines.push(`- 类型: ${item.unitType}`);
    lines.push(`- 预期输入: ${item.expectedInput}`);
    lines.push(`- 预期输出: ${item.expectedOutput}`);
    lines.push(`- 边界条件: ${item.boundaryConditions}`);
    lines.push(`- 验证方式: ${item.verificationMethod}`);
    if (item.actualResult) {
      lines.push(`- 实际结果: ${item.actualResult}`);
    }
    if (item.notes) {
      lines.push(`- 备注: ${item.notes}`);
    }
    lines.push('');
  }

  if (todo.conclusion) {
    lines.push('## 调试结论');
    lines.push('');
    lines.push(`### ✅ 已按设计实现且验证通过`);
    lines.push(...(todo.conclusion.passed.length > 0 ? todo.conclusion.passed.map((s) => `- ${s}`) : ['- 无']));
    lines.push('');
    lines.push(`### ⚠️ 已实现但与设计不一致`);
    lines.push(...(todo.conclusion.inconsistent.length > 0 ? todo.conclusion.inconsistent.map((s) => `- ${s}`) : ['- 无']));
    lines.push('');
    lines.push(`### ❌ 设计要求存在但实现缺失`);
    lines.push(...(todo.conclusion.missing.length > 0 ? todo.conclusion.missing.map((s) => `- ${s}`) : ['- 无']));
    lines.push('');
    lines.push(`### ❓ 当前无法验证，需补充环境或证据`);
    lines.push(...(todo.conclusion.unverifiable.length > 0 ? todo.conclusion.unverifiable.map((s) => `- ${s}`) : ['- 无']));
  }

  return lines.filter(Boolean).join('\n');
}

/**
 * 根据 triggerReason 推断推荐的调试深度
 */
export function inferDebugDepth(triggerReason: string): DebugTodo['debugDepth'] {
  const lower = triggerReason.toLowerCase();
  if (lower.includes('全链路') || lower.includes('端到端') || lower.includes('e2e')) {
    return 'full_link';
  }
  if (lower.includes('存储') || lower.includes('redis') || lower.includes('数据库') || lower.includes('db')) {
    return 'storage_verification';
  }
  if (lower.includes('接口') || lower.includes('api') || lower.includes('路由')) {
    return 'interface_only';
  }
  return 'real_link';
}
