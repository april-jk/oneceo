import { sanitizePptFileName } from './ppt-render-instruction-validator';

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

function parseHtmlDeckSpecInput(value: unknown) {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      throw new Error('ppt_html_deck_spec_json_invalid');
    }
  }
  return value;
}

function isSafeRelativeFilePath(value: string) {
  if (!value || value.startsWith('/') || value.includes('\\')) return false;
  const parts = value.split('/');
  return parts.every((part) => part && part !== '.' && part !== '..');
}

export type HtmlDeckSpecValidationResult = {
  spec: Record<string, unknown>;
  slideCount: number;
  fileName: string;
  aspectRatio: '16:9' | '4:3';
};

function normalizeAspectRatio(value: unknown): '16:9' | '4:3' {
  const normalized = asText(value).replace(/\s+/g, '');
  return normalized === '4:3' ? '4:3' : '16:9';
}

export function validateHtmlDeckSpec(value: unknown): HtmlDeckSpecValidationResult {
  const spec = asRecord(parseHtmlDeckSpecInput(value));
  if (!Object.keys(spec).length) {
    throw new Error('ppt_html_deck_spec_missing');
  }

  const deck = asRecord(spec.deck);
  const slides = Array.isArray(spec.slides) ? spec.slides : [];
  const openQuestions = Array.isArray(spec.openQuestions) ? spec.openQuestions : [];
  const errors: string[] = [];
  const normalizedSlides: Record<string, unknown>[] = [];
  const ids = new Set<string>();

  if (asText(spec.taskType) !== 'ppt_html_deck') {
    errors.push('taskType must be ppt_html_deck');
  }
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

  slides.forEach((slide, index) => {
    const record = asRecord(slide);
    const expectedIndex = index + 1;
    const slideIndex = asPositiveInteger(record.index);
    const id = asText(record.id);
    const htmlFile = asText(record.htmlFile);

    if (!id) {
      errors.push(`slides[${index}].id is required`);
    } else if (ids.has(id)) {
      errors.push(`slides[${index}].id must be unique`);
    } else {
      ids.add(id);
    }
    if (slideIndex !== expectedIndex) {
      errors.push(`slides[${index}].index must be ${expectedIndex}`);
    }
    if (!asText(record.slideArchetype)) {
      errors.push(`slides[${index}].slideArchetype is required`);
    }
    if (!htmlFile) {
      errors.push(`slides[${index}].htmlFile is required`);
    } else if (!isSafeRelativeFilePath(htmlFile)) {
      errors.push(`slides[${index}].htmlFile must be a safe relative path`);
    }

    normalizedSlides.push({
      ...record,
      id,
      index: expectedIndex,
      htmlFile,
    });
  });

  if (errors.length > 0) {
    throw new Error(`ppt_html_deck_spec_invalid: ${errors.join('; ')}`);
  }

  return {
    spec: {
      ...spec,
      taskType: 'ppt_html_deck',
      deck: {
        ...deck,
        aspectRatio: normalizeAspectRatio(deck.aspectRatio),
      },
      slides: normalizedSlides,
    },
    slideCount: slides.length,
    fileName: sanitizePptFileName(deck.outputFileName, `${asText(deck.title) || 'oneceo-presentation'}.pptx`),
    aspectRatio: normalizeAspectRatio(deck.aspectRatio),
  };
}

export const pptHtmlDeckValidator = {
  validate: validateHtmlDeckSpec,
};
