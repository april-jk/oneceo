type TransferFileItem = {
  kind?: string;
  getAsFile?: () => File | null;
};

type FileTransferLike = {
  files?: ArrayLike<File> | null;
  items?: ArrayLike<TransferFileItem> | null;
  types?: ArrayLike<string> | null;
};

function buildFileKey(file: File) {
  return `${file.name}:${file.size}:${file.type}:${file.lastModified}`;
}

export function hasFileTransfer(dataTransfer?: FileTransferLike | null) {
  if (!dataTransfer) return false;
  const types = Array.from(dataTransfer.types || []);
  if (types.includes("Files")) return true;
  if (dataTransfer.files && dataTransfer.files.length > 0) return true;
  return Array.from(dataTransfer.items || []).some(
    (item) => item.kind === "file",
  );
}

export function extractFilesFromTransfer(
  dataTransfer?: FileTransferLike | null,
) {
  if (!dataTransfer) return [];

  const files: File[] = [];
  const seen = new Set<string>();
  const addFile = (file: File | null | undefined) => {
    if (!file) return;
    const key = buildFileKey(file);
    if (seen.has(key)) return;
    seen.add(key);
    files.push(file);
  };

  Array.from(dataTransfer.items || []).forEach((item) => {
    if (item.kind && item.kind !== "file") return;
    addFile(item.getAsFile?.());
  });

  Array.from(dataTransfer.files || []).forEach(addFile);

  return files;
}
