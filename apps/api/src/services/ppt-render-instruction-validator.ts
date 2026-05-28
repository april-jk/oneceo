const SUPPORTED_PAGE_TYPES = new Set([
  'cover',
  'agenda',
  'section-divider',
  'content',
  'comparison',
  'timeline',
  'quote',
  'closing',
]);

const PAGE_TYPE_ALIASES: Record<string, string> = {
  title: 'cover',
  title_slide: 'cover',
  intro: 'content',
  introduction: 'content',
  overview: 'content',
  summary: 'closing',
  recap: 'closing',
  conclusion: 'closing',
  end: 'closing',
  qna: 'closing',
  qa: 'closing',
  feature: 'comparison',
  features: 'comparison',
  capability: 'comparison',
  capabilities: 'comparison',
  function: 'comparison',
  functions: 'comparison',
  technical: 'content',
  technology: 'content',
  architecture: 'content',
  principle: 'content',
  principles: 'content',
  usecase: 'content',
  usecases: 'content',
  use_case: 'content',
  use_cases: 'content',
  scenario: 'content',
  scenarios: 'content',
  demo: 'content',
  case: 'content',
  cases: 'content',
  example: 'content',
  examples: 'content',
  advantage: 'comparison',
  advantages: 'comparison',
  benefit: 'comparison',
  benefits: 'comparison',
  value: 'content',
  workflow: 'timeline',
  process: 'timeline',
  roadmap: 'timeline',
  toc: 'agenda',
  table_of_contents: 'agenda',
  agenda_slide: 'agenda',
  divider: 'section-divider',
  section: 'section-divider',
  section_divider: 'section-divider',
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function asPositiveInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function hasThemeTokenGroup(value: unknown, keys: string[]) {
  const record = asRecord(value);
  return keys.some((key) => Object.prototype.hasOwnProperty.call(record, key));
}

function parseInstructionInput(value: unknown) {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      throw new Error('ppt_render_instruction_json_invalid');
    }
  }
  return value;
}

function normalizePageType(value: unknown) {
  const raw = asText(value).toLowerCase();
  if (!raw) return '';
  const normalized = raw.replace(/[\s_-]+/g, '-');
  const aliasKey = raw.replace(/[\s-]+/g, '_');
  if (SUPPORTED_PAGE_TYPES.has(raw)) return raw;
  if (SUPPORTED_PAGE_TYPES.has(normalized)) return normalized;
  return PAGE_TYPE_ALIASES[raw] || PAGE_TYPE_ALIASES[normalized] || PAGE_TYPE_ALIASES[aliasKey] || 'content';
}

export type PptRenderInstructionValidationResult = {
  instruction: Record<string, unknown>;
  slideCount: number;
  fileName: string;
};

export function sanitizePptFileName(value: unknown, fallback = 'oneceo-presentation.pptx') {
  const raw = asText(value) || fallback;
  const withoutPath = raw.split('/').pop()?.split('\\').pop() || fallback;
  const sanitized = withoutPath.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
  const base = sanitized.toLowerCase().endsWith('.pptx') ? sanitized.slice(0, -5) : sanitized;
  return `${(base || 'oneceo-presentation').slice(0, 123)}.pptx`;
}

export function validatePptRenderInstruction(value: unknown): PptRenderInstructionValidationResult {
  const instruction = asRecord(parseInstructionInput(value));
  if (!Object.keys(instruction).length) {
    throw new Error('ppt_render_instruction_missing');
  }

  const deck = asRecord(instruction.deck);
  const theme = asRecord(instruction.theme);
  const slides = Array.isArray(instruction.slides) ? instruction.slides : [];
  const openQuestions = Array.isArray(instruction.openQuestions) ? instruction.openQuestions : [];
  const normalizedSlides: Record<string, unknown>[] = [];
  const errors: string[] = [];

  if (!asText(deck.title)) {
    errors.push('deck.title is required');
  }

  const declaredSlideCount = asPositiveInteger(deck.slideCount) || slides.length;
  if (declaredSlideCount <= 0) {
    errors.push('deck.slideCount must be greater than 0');
  }
  if (slides.length === 0) {
    errors.push('slides must contain at least one slide');
  }
  if (declaredSlideCount > 0 && slides.length > 0 && declaredSlideCount !== slides.length) {
    errors.push('deck.slideCount must match slides.length');
  }
  if (openQuestions.length > 0) {
    errors.push('openQuestions must be empty before rendering');
  }

  const colorTokens = asRecord(theme.colorTokens);
  if (!hasThemeTokenGroup(colorTokens, ['background', 'backgroundColor', 'bg'])) {
    errors.push('theme.colorTokens.background is required');
  }
  if (!hasThemeTokenGroup(colorTokens, ['primary', 'primaryColor', 'accent'])) {
    errors.push('theme.colorTokens.primary is required');
  }
  if (!hasThemeTokenGroup(colorTokens, ['text', 'textColor', 'foreground'])) {
    errors.push('theme.colorTokens.text is required');
  }

  slides.forEach((slide, index) => {
    const record = asRecord(slide);
    const expectedIndex = index + 1;
    const slideIndex = asPositiveInteger(record.index);
    const pageType = normalizePageType(record.pageType);
    if (slideIndex !== expectedIndex) {
      errors.push(`slides[${index}].index must be ${expectedIndex}`);
    }
    if (!pageType) {
      errors.push(`slides[${index}].pageType is required`);
    }
    if (!asText(record.title) && !asText(record.coreMessage)) {
      errors.push(`slides[${index}] must include title or coreMessage`);
    }
    normalizedSlides.push({
      ...record,
      pageType,
      originalPageType: asText(record.pageType) && asText(record.pageType) !== pageType ? asText(record.pageType) : undefined,
    });
  });

  if (errors.length > 0) {
    throw new Error(`ppt_render_instruction_invalid: ${errors.join('; ')}`);
  }

  return {
    instruction: {
      ...instruction,
      slides: normalizedSlides,
    },
    slideCount: slides.length,
    fileName: sanitizePptFileName(deck.fileName, `${asText(deck.title) || 'oneceo-presentation'}.pptx`),
  };
}

export const pptRenderInstructionValidator = {
  validate: validatePptRenderInstruction,
  sanitizeFileName: sanitizePptFileName,
};
