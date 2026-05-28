const INTERNAL_SUPPORT_FILE_NAMES = new Set([
  "document_manifest.json",
  "presentation_manifest.json",
  "workbook_manifest.json",
]);

function normalizeManagedArtifactPath(pathRaw?: string | null): string {
  return typeof pathRaw === "string" ? pathRaw.trim().replace(/\\/g, "/") : "";
}

function isPptHtmlDeckFinalPptx(path: string): boolean {
  return /^ppt-html-deck\/export\/[^/]+\.pptx$/i.test(path.toLowerCase());
}

export function isManagedInternalSupportArtifact(pathRaw?: string | null): boolean {
  const normalized = normalizeManagedArtifactPath(pathRaw);
  const normalizedLower = normalized.toLowerCase();
  if (!normalized) return false;
  const fileName = normalizedLower.split("/").pop() || "";
  if (!fileName) return false;
  if (
    (normalizedLower === "ppt-html-deck" || normalizedLower.startsWith("ppt-html-deck/")) &&
    !isPptHtmlDeckFinalPptx(normalizedLower)
  ) {
    return true;
  }
  if (INTERNAL_SUPPORT_FILE_NAMES.has(fileName)) return true;
  return fileName.endsWith(".render-report.json");
}
