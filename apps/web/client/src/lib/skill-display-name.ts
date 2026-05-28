import type { TaskCreationPlatformSkill } from "@/lib/task-creation-client";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LONG_HASH_PATTERN = /^[0-9a-f]{16,}$/i;
const HASH_SUFFIX_PATTERN =
  /(?:[\s:：·_\-—–(（\[]+)([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|[0-9a-f]{16,})(?:[)）\]]*)$/i;

function asDisplayText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isOpaqueSkillToken(value: string): boolean {
  const text = value.trim();
  return UUID_PATTERN.test(text) || LONG_HASH_PATTERN.test(text);
}

function stripOpaqueSuffix(value: string): string {
  let text = value.trim();
  while (HASH_SUFFIX_PATTERN.test(text)) {
    text = text.replace(HASH_SUFFIX_PATTERN, "").trim();
  }
  return text;
}

function prettifySlug(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function getSkillDisplayName(
  skill: Pick<TaskCreationPlatformSkill, "name" | "slug" | "skillId">,
): string {
  const candidates = [skill.name, skill.slug, skill.skillId]
    .map(asDisplayText)
    .filter(Boolean);

  for (const candidate of candidates) {
    if (isOpaqueSkillToken(candidate)) {
      continue;
    }
    const stripped = stripOpaqueSuffix(candidate);
    if (stripped && !isOpaqueSkillToken(stripped)) {
      return prettifySlug(stripped);
    }
  }

  return "Skill";
}
