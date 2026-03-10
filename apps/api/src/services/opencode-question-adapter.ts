export type OpencodeQuestionOption = {
  label?: string;
  description?: string;
  text?: string;
  value?: string;
};

export type OpencodeQuestionPrompt = {
  question?: string;
  header?: string;
  multiple?: boolean;
  options?: OpencodeQuestionOption[];
};

export type OpencodePendingQuestion = {
  id?: string;
  sessionID?: string;
  questions?: OpencodeQuestionPrompt[];
  tool?: {
    messageID?: string;
    callID?: string;
  };
};

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/node\.js/g, 'nodejs')
    .replace(/type script/g, 'typescript')
    .replace(/java script/g, 'javascript')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

const GENERIC_SUFFIXES = ['功能', '应用', '工具', '软件', '系统', '平台', '备忘录'];

function splitFragments(value: string): string[] {
  const source = value.trim();
  if (!source) return [];

  const normalizedParts = unique([
    source,
    ...source.split(/[\/|,，、;；+()（）\-_\s]+/g),
    ...source.split(/(?:和|或|及|与|and|or)/gi),
  ])
    .map((item) => normalizeText(item))
    .filter((item) => item.length >= 2 && item.length <= 32);

  const expandedParts = normalizedParts.flatMap((item) => {
    const variants = [item];
    for (const suffix of GENERIC_SUFFIXES) {
      const normalizedSuffix = normalizeText(suffix);
      if (normalizedSuffix && item.endsWith(normalizedSuffix)) {
        const trimmed = item.slice(0, -normalizedSuffix.length);
        if (trimmed.length >= 2) {
          variants.push(trimmed);
        }
      }
    }
    return variants;
  });

  return unique(expandedParts);
}

function optionLabel(option: OpencodeQuestionOption): string {
  return asText(option.label) || asText(option.text) || asText(option.value) || asText(option.description);
}

function scoreOptionMatch(option: OpencodeQuestionOption, input: string): number {
  const normalizedInput = normalizeText(input);
  if (!normalizedInput) return 0;

  const label = asText(option.label);
  const text = asText(option.text);
  const value = asText(option.value);
  const description = asText(option.description);
  const primaryCandidates = [label, text, value].filter(Boolean);
  const secondaryCandidates = [description].filter(Boolean);

  let score = 0;
  for (const candidate of primaryCandidates) {
    const normalizedCandidate = normalizeText(candidate);
    if (!normalizedCandidate) continue;
    if (!normalizedInput.includes(normalizedCandidate)) continue;
    if (candidate === label) {
      score += 6;
    } else {
      score += 5;
    }
  }

  for (const candidate of secondaryCandidates) {
    const normalizedCandidate = normalizeText(candidate);
    if (normalizedCandidate && normalizedInput.includes(normalizedCandidate)) {
      score += 4;
    }
  }

  const primaryFragments = unique(primaryCandidates.flatMap((candidate) => splitFragments(candidate)));
  for (const fragment of primaryFragments) {
    if (normalizedInput.includes(fragment)) {
      score += 2;
    }
  }

  const secondaryFragments = unique(secondaryCandidates.flatMap((candidate) => splitFragments(candidate)));
  for (const fragment of secondaryFragments) {
    if (normalizedInput.includes(fragment)) {
      score += 1;
    }
  }

  return score;
}

function pickMatchedAnswers(question: OpencodeQuestionPrompt, input: string): string[] {
  const options = Array.isArray(question.options) ? question.options : [];
  if (options.length === 0) return [];

  const scored = options
    .map((option) => ({
      label: optionLabel(option),
      score: scoreOptionMatch(option, input),
    }))
    .filter((item) => item.label && item.score > 0)
    .sort((left, right) => right.score - left.score || left.label.localeCompare(right.label));

  if (scored.length === 0) return [];

  if (question.multiple) {
    const strongestScore = scored[0]?.score ?? 0;
    const threshold = Math.max(2, Math.ceil(strongestScore / 2));
    return unique(
      scored
        .filter((item) => item.score >= threshold)
        .slice(0, 4)
        .map((item) => item.label)
    );
  }

  return [scored[0].label];
}

export function buildOpencodeQuestionAnswers(
  questions: OpencodeQuestionPrompt[] | undefined,
  input: string
): string[][] {
  const text = asText(input);
  if (!text) return [];

  const normalizedQuestions = Array.isArray(questions) ? questions : [];
  if (normalizedQuestions.length === 0) {
    return [[text]];
  }

  return normalizedQuestions.map((question) => {
    const matchedAnswers = pickMatchedAnswers(question, text);
    return matchedAnswers.length > 0 ? matchedAnswers : [text];
  });
}

export function findPendingOpencodeQuestion(
  questions: OpencodePendingQuestion[] | undefined,
  opencodeSessionId: string
): OpencodePendingQuestion | null {
  const list = Array.isArray(questions) ? questions : [];
  const targetSessionId = asText(opencodeSessionId);
  if (!targetSessionId) {
    return list.length > 0 ? list[list.length - 1] || null : null;
  }

  for (let index = list.length - 1; index >= 0; index -= 1) {
    const item = list[index];
    if (asText(item?.sessionID) === targetSessionId) {
      return item;
    }
  }

  return null;
}
