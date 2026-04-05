export type SlashReferenceKind = "skill" | "mcp";

export type SlashQuery = {
  raw: string;
  keyword: string;
  kind: SlashReferenceKind | "all";
  start: number;
  end: number;
};

const SKILL_SUFFIX = "-skills";
const MCP_SUFFIX = "-mcp";

export function parseTrailingSlashQuery(input: string): SlashQuery | null {
  const match = input.match(/(?:^|\s)\/([^\s]*)$/);
  if (!match) return null;
  const raw = (match[1] || "").trim();
  if (!raw) {
    return {
      raw,
      keyword: "",
      kind: "all",
      start: match.index ?? 0,
      end: input.length,
    };
  }

  if (raw.endsWith(SKILL_SUFFIX)) {
    return {
      raw,
      keyword: raw.slice(0, -SKILL_SUFFIX.length).trim(),
      kind: "skill",
      start: match.index ?? 0,
      end: input.length,
    };
  }

  if (raw.endsWith(MCP_SUFFIX)) {
    return {
      raw,
      keyword: raw.slice(0, -MCP_SUFFIX.length).trim(),
      kind: "mcp",
      start: match.index ?? 0,
      end: input.length,
    };
  }

  return {
    raw,
    keyword: raw,
    kind: "all",
    start: match.index ?? 0,
    end: input.length,
  };
}

export function stripTrailingSlashQuery(input: string): string {
  const parsed = parseTrailingSlashQuery(input);
  if (!parsed) return input;
  const left = input.slice(0, parsed.start).trimEnd();
  return left ? `${left} ` : "";
}

export function buildSlashText(kind: SlashReferenceKind, value: string): string {
  const safe = (value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
  if (!safe) return "";
  return `/${safe}${kind === "skill" ? SKILL_SUFFIX : MCP_SUFFIX}`;
}
