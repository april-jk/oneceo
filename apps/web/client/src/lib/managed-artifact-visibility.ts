const INTERNAL_SUPPORT_FILE_NAMES = new Set([
  "document_manifest.json",
  "presentation_manifest.json",
  "workbook_manifest.json",
]);

function normalizeManagedArtifactPath(pathRaw?: string | null): string {
  return typeof pathRaw === "string" ? pathRaw.trim().replace(/\\/g, "/") : "";
}

export function isManagedInternalSupportArtifact(pathRaw?: string | null): boolean {
  const normalized = normalizeManagedArtifactPath(pathRaw);
  if (!normalized) return false;
  const fileName = normalized.split("/").pop()?.toLowerCase() || "";
  if (!fileName) return false;
  if (INTERNAL_SUPPORT_FILE_NAMES.has(fileName)) return true;
  return fileName.endsWith(".render-report.json");
}
