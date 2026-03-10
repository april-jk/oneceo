export type NormalizedOpencodeModel = {
  providerId: string;
  modelId: string;
  fullModel: string;
};

function fallbackProvider(input?: string | null): string {
  const raw = String(input || '').trim();
  if (!raw) return 'openai';
  const normalized = raw.replace(/\s+/g, '');
  return /^[A-Za-z0-9._-]+$/.test(normalized) ? normalized : 'openai';
}

export function normalizeOpencodeModel(
  modelRaw: string | undefined | null,
  providerRaw?: string | null
): NormalizedOpencodeModel | null {
  const model = String(modelRaw || '').trim();
  if (!model) {
    return null;
  }

  const slashIndex = model.indexOf('/');
  if (slashIndex > 0 && slashIndex < model.length - 1) {
    const providerId = fallbackProvider(model.slice(0, slashIndex));
    const modelId = model.slice(slashIndex + 1).trim();
    if (!modelId) {
      return null;
    }
    return {
      providerId,
      modelId,
      fullModel: `${providerId}/${modelId}`,
    };
  }

  const providerId = fallbackProvider(providerRaw);
  return {
    providerId,
    modelId: model,
    fullModel: `${providerId}/${model}`,
  };
}

