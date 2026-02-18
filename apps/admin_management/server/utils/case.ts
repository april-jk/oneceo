export function toCamelKey(input: string): string {
  return input.replace(/_([a-z])/g, (_match, char: string) => char.toUpperCase());
}

export function deepCamelCase<T = unknown>(input: unknown): T {
  if (Array.isArray(input)) {
    return input.map((item) => deepCamelCase(item)) as T;
  }

  if (!input || typeof input !== 'object') {
    return input as T;
  }

  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    output[toCamelKey(key)] = deepCamelCase(value);
  }

  return output as T;
}