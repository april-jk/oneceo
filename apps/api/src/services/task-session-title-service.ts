export const DEFAULT_SESSION_TITLE = '待识别任务';
export const WAITING_SESSION_TITLE = '待补充需求';
export const LEGACY_DEFAULT_SESSION_TITLE = '新建任务会话';

export const NON_EXPLICIT_SESSION_TITLE_MAX_LENGTH = 24;
export const RESOLVED_SESSION_TITLE_MAX_LENGTH = 80;

export type SessionTitleSource =
  | 'placeholder'
  | 'first_user_input'
  | 'first_explicit_user_input'
  | 'task_description'
  | 'clarification_summary'
  | 'manual';

export type SessionTitleState = 'provisional' | 'resolved' | 'manual';

const WEAK_INTENT_TITLE_INPUTS = new Set([
  '你好',
  '您好',
  '嗨',
  'hi',
  'hello',
  'hey',
  '在吗',
  '有人吗',
  'help',
  '帮我一下',
  '开始',
  '继续',
  'ok',
  'okay',
  '好的',
  '收到',
  '1',
  '？',
  '?',
]);

export function asTitleText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function sanitizeSessionTitleText(value: unknown): string {
  return asTitleText(value).replace(/\s+/g, ' ').trim();
}

function toComparableTitleText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[，。、“”"'!！?？,.；;:：()\[\]{}<>《》【】\-_`~]/g, '')
    .replace(/\s+/g, '');
}

export function isWeakIntentTitleInput(value: string): boolean {
  const comparable = toComparableTitleText(value);
  if (!comparable) return true;
  if (WEAK_INTENT_TITLE_INPUTS.has(comparable)) return true;
  if (comparable.length <= 2) return true;
  return false;
}

export function isExplicitSessionTitleInput(value: string): boolean {
  const normalized = sanitizeSessionTitleText(value);
  if (!normalized) return false;
  if (isWeakIntentTitleInput(normalized)) return false;
  if (normalized.length >= 12) return true;
  return /(帮我|请|请帮|分析|排查|修复|开发|实现|优化|重构|设计|生成|创建|制作|写|继续|修改|整理|总结|如何|怎么|为什么|报错|bug|问题|页面|功能|css|html|nodejs|代码|接口|数据库|deploy|build|fix|debug|analy[sz]e|implement|optimi[sz]e|refactor|create|write)/i.test(
    normalized
  );
}

export function deriveResolvedSessionTitle(value: unknown): string {
  return sanitizeSessionTitleText(value).slice(0, RESOLVED_SESSION_TITLE_MAX_LENGTH);
}

export function resolvePlaceholderSessionTitle(status: unknown): string {
  return asTitleText(status) === 'waiting_user' ? WAITING_SESSION_TITLE : DEFAULT_SESSION_TITLE;
}

function isLegacyIdStyleSessionTitle(value: string): boolean {
  return /^任务会话\s+[a-z0-9]{4,}$/i.test(value.trim());
}

export function isPlaceholderSessionTitle(value: unknown): boolean {
  const normalized = deriveResolvedSessionTitle(value);
  if (!normalized) return true;
  return (
    normalized === DEFAULT_SESSION_TITLE ||
    normalized === WAITING_SESSION_TITLE ||
    normalized === LEGACY_DEFAULT_SESSION_TITLE ||
    isLegacyIdStyleSessionTitle(normalized)
  );
}

function cleanupSessionTitleObject(value: string): string {
  return value
    .replace(/^(?:请|请你|请帮我|帮我|麻烦你|这个|该|当前|目前|刚才的?|一下|一轮|一次|关于)\s*/i, '')
    .replace(/^(?:分析|排查|定位|修复|优化|重构|整理|总结|调研)\s*/i, '')
    .replace(/(?:的根因|根因|原因)$/i, '')
    .replace(/[，,。；;：:!！?？]+$/g, '')
    .replace(/\bhtml\b/gi, 'HTML')
    .replace(/\bcss\b/gi, 'CSS')
    .replace(/\bnode(?:\.js|js)\b/gi, 'Node.js')
    .replace(/\breact\b/gi, 'React')
    .replace(/\bvue\b/gi, 'Vue')
    .replace(/\brailway\b/gi, 'Railway')
    .replace(/\bapi\b/gi, 'API')
    .replace(/\bdb\b/gi, 'DB')
    .replace(/\b(v\d+)(?=[\u4e00-\u9fff])/gi, '$1 ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripSessionTitleLeadPhrases(value: string): string {
  let text = value.trim();
  const patterns = [
    /^(?:你好|您好|嗨|hi|hello|hey)[，,\s:：-]*/i,
    /^(?:请问|请帮我|请帮|请你|帮我|麻烦你|想请你|我想让你|我想|我需要)[，,\s:：-]*/i,
    /^(?:继续|再|然后|现在|目前)[，,\s:：-]*/i,
    /^(?:做一次|来一次|做个|看下|看一下|处理一下|处理下|帮我看下|帮我看一下|帮我处理一下)[，,\s:：-]*/i,
  ];
  let changed = true;
  while (changed) {
    changed = false;
    for (const pattern of patterns) {
      const next = text.replace(pattern, '').trim();
      if (next !== text) {
        text = next;
        changed = true;
      }
    }
  }
  return text.trim();
}

export function deriveAutoSessionTitle(value: unknown): string {
  const normalized = sanitizeSessionTitleText(value);
  if (!normalized) return '';
  if (isWeakIntentTitleInput(normalized) || !isExplicitSessionTitleInput(normalized)) {
    return deriveResolvedSessionTitle(normalized).slice(0, NON_EXPLICIT_SESSION_TITLE_MAX_LENGTH);
  }

  let text =
    normalized
      .split(/[。！？!?；;\n]/)
      .map((part) => part.trim())
      .find(Boolean) || normalized;
  text = stripSessionTitleLeadPhrases(text);
  text = cleanupSessionTitleObject(text);

  if (!text || isWeakIntentTitleInput(text)) {
    return deriveResolvedSessionTitle(normalized).slice(0, NON_EXPLICIT_SESSION_TITLE_MAX_LENGTH);
  }

  if (/(?:2048).*(?:小游戏|游戏)|(?:小游戏|游戏).*(?:2048)/i.test(text) && /\bhtml\b/i.test(text)) {
    return 'HTML 2048 小游戏';
  }

  const issueMatch = text.match(/^(.*?)(报错|错误|失败|异常)(?:的)?(?:根因|原因)?$/);
  if (issueMatch) {
    const objectText = cleanupSessionTitleObject(issueMatch[1]);
    const issueText = cleanupSessionTitleObject(issueMatch[2]);
    return deriveResolvedSessionTitle(`${objectText}${issueText}分析`);
  }

  const questionMatch = text.match(/^(?:为什么|怎么|如何)(.+)$/);
  if (questionMatch) {
    const objectText = cleanupSessionTitleObject(questionMatch[1]);
    return deriveResolvedSessionTitle(objectText ? `${objectText}问题` : '');
  }

  const actionSuffixMap: Record<string, string> = {
    分析: '分析',
    排查: '排查',
    定位: '定位',
    修复: '修复',
    优化: '优化',
    重构: '重构',
    整理: '整理',
    总结: '总结',
    调研: '调研',
  };
  const actionMatch = text.match(/^(分析|排查|定位|修复|优化|重构|整理|总结|调研)(.+)$/);
  if (actionMatch) {
    const objectText = cleanupSessionTitleObject(actionMatch[2]);
    return deriveResolvedSessionTitle(objectText ? `${objectText}${actionSuffixMap[actionMatch[1]]}` : actionMatch[1]);
  }

  const buildMatch = text.match(/^(开发|实现|创建|生成|制作|设计|编写|写)(.+)$/);
  if (buildMatch) {
    const objectText = cleanupSessionTitleObject(buildMatch[2]);
    return deriveResolvedSessionTitle(objectText);
  }

  const changeMatch = text.match(/^把(.+?)(?:改成|改为|做成|改到)(.+)$/);
  if (changeMatch) {
    const fromText = cleanupSessionTitleObject(changeMatch[1]);
    const toText = cleanupSessionTitleObject(changeMatch[2]);
    return deriveResolvedSessionTitle([fromText, toText ? `改为${toText}` : ''].filter(Boolean).join(' '));
  }

  return deriveResolvedSessionTitle(text).slice(0, 32);
}

export function getSessionTitleSourcePriority(value: unknown): number {
  switch (asTitleText(value)) {
    case 'manual':
      return 5;
    case 'task_description':
      return 4;
    case 'clarification_summary':
      return 3;
    case 'first_explicit_user_input':
    case 'first_user_input':
      return 2;
    case 'placeholder':
    default:
      return 1;
  }
}

export function normalizeStoredSessionTitleSource(value: unknown): SessionTitleSource | null {
  const source = asTitleText(value);
  if (
    source === 'first_user_input' ||
    source === 'first_explicit_user_input' ||
    source === 'task_description' ||
    source === 'clarification_summary' ||
    source === 'manual' ||
    source === 'placeholder'
  ) {
    return source;
  }
  return null;
}

export function normalizeStoredSessionTitleState(value: unknown): SessionTitleState | null {
  const state = asTitleText(value);
  if (state === 'provisional' || state === 'resolved' || state === 'manual') {
    return state;
  }
  return null;
}

export function resolveDisplaySessionTitle(input: {
  storedTitle?: unknown;
  storedTitleSource?: unknown;
  storedTitleState?: unknown;
  taskDescriptionTitle?: unknown;
  firstUserMessage?: unknown;
  status?: unknown;
}) {
  const storedTitle = deriveResolvedSessionTitle(input.storedTitle);
  const storedTitleSource = normalizeStoredSessionTitleSource(input.storedTitleSource);
  const storedTitleState = normalizeStoredSessionTitleState(input.storedTitleState);
  const taskDescriptionTitle = deriveResolvedSessionTitle(input.taskDescriptionTitle);
  const firstUserMessageTitle = deriveAutoSessionTitle(input.firstUserMessage);

  if (storedTitle && !isPlaceholderSessionTitle(storedTitle)) {
    const inferredSource = storedTitleSource || 'manual';
    return {
      title: storedTitle,
      titleSource: inferredSource,
      titleState:
        storedTitleState ||
        (inferredSource === 'manual'
          ? 'manual'
          : inferredSource === 'task_description' || inferredSource === 'clarification_summary'
            ? 'resolved'
            : 'provisional'),
    };
  }
  if (taskDescriptionTitle) {
    return {
      title: taskDescriptionTitle,
      titleSource: 'task_description' as const,
      titleState: 'resolved' as const,
    };
  }
  if (firstUserMessageTitle) {
    return {
      title: firstUserMessageTitle,
      titleSource: 'first_user_input' as const,
      titleState: 'provisional' as const,
    };
  }
  return {
    title: resolvePlaceholderSessionTitle(input.status),
    titleSource: 'placeholder' as const,
    titleState: 'provisional' as const,
  };
}
