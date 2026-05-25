export type PreviewServiceContractSource =
  | 'manifest'
  | 'package_script'
  | 'oneceo_fixed_shell'
  | 'command';

export type PreviewServiceContract = {
  command: string;
  port: number;
  healthPath?: string;
  source: PreviewServiceContractSource;
  appendVitePortArgs?: boolean;
  persistent: boolean;
};

const ONECEO_FIXED_SHELL_DEFAULT_PORT = 8080;
const ONECEO_FIXED_SHELL_HEALTH_PATH = '/api/system/health';

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function extractNumber(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed);
}

export function normalizePreviewServiceCommand(value: string) {
  return asText(value).toLowerCase().replace(/\s+/g, ' ');
}

export function extractPreviewServicePort(command: string): number | null {
  const match =
    command.match(/(?:--port|-p)\s+(\d{2,5})/) ||
    command.match(/:(\d{2,5})(?:\b|["'])/) ||
    command.match(/\bPORT=(\d{2,5})\b/i);
  if (!match) return null;
  return extractNumber(match[1]);
}

export function isOneCeoFixedShellCommand(value: string) {
  const normalized = normalizePreviewServiceCommand(value);
  if (!normalized) return false;
  return /(?:^|(?:&&|;|\|)\s*|\s)(?:[a-z_][a-z0-9_]*=\S+\s+)*node\s+dist\/index\.js(?:\s|$)/i.test(normalized);
}

export function isPackageStartCommand(value: string) {
  const normalized = normalizePreviewServiceCommand(value);
  if (!normalized) return false;
  return (
    /(?:^|(?:&&|;)\s*)npm\s+(?:run\s+)?start(?:\s|$)/.test(normalized) ||
    /(?:^|(?:&&|;)\s*)pnpm\s+start(?:\s|$)/.test(normalized) ||
    /(?:^|(?:&&|;)\s*)yarn\s+start(?:\s|$)/.test(normalized) ||
    /(?:^|(?:&&|;)\s*)bun\s+(?:run\s+)?start(?:\s|$)/.test(normalized)
  );
}

export function inferPackageManager(packageJson: Record<string, unknown>): 'pnpm' | 'yarn' | 'bun' | 'npm' {
  const packageManager = asText(packageJson.packageManager).toLowerCase();
  if (packageManager.startsWith('pnpm@')) return 'pnpm';
  if (packageManager.startsWith('yarn@')) return 'yarn';
  if (packageManager.startsWith('bun@')) return 'bun';
  return 'npm';
}

export function buildScriptCommand(manager: 'pnpm' | 'yarn' | 'bun' | 'npm', scriptName: string): string {
  if (manager === 'pnpm') return `pnpm ${scriptName}`;
  if (manager === 'yarn') return `yarn ${scriptName}`;
  if (manager === 'bun') return `bun run ${scriptName}`;
  return `npm run ${scriptName}`;
}

export function isViteLikeScript(scriptName: string, scriptCommand: string): boolean {
  const normalized = `${scriptName} ${scriptCommand}`.toLowerCase();
  return (
    normalized.includes('vite') ||
    normalized.includes('react-scripts start') ||
    scriptName === 'dev' ||
    scriptName === 'preview'
  );
}

export function getDefaultPortForScript(scriptName: string, scriptCommand: string): number {
  const normalized = `${scriptName} ${scriptCommand}`.toLowerCase();
  if (isOneCeoFixedShellCommand(scriptCommand)) return ONECEO_FIXED_SHELL_DEFAULT_PORT;
  if (scriptName === 'preview') return 4173;
  if (scriptName === 'dev' && normalized.includes('vite')) return 5173;
  return 3000;
}

function readHealthPath(manifest: Record<string, unknown> | null | undefined) {
  const healthcheck = asRecord(manifest?.healthcheck);
  const path = asText(healthcheck.path);
  if (!path) return undefined;
  return path.startsWith('/') ? path : `/${path}`;
}

function readManifestStart(manifest: Record<string, unknown> | null | undefined) {
  const start = asRecord(manifest?.start);
  const command = asText(start.command);
  if (!command) return null;
  return {
    command,
    port: extractNumber(start.port) || extractNumber(start.defaultPort),
    healthPath: readHealthPath(manifest),
  };
}

export function resolvePreviewServiceContract(input: {
  command: string;
  manifest?: Record<string, unknown> | null;
  packageJson?: Record<string, unknown> | null;
}): PreviewServiceContract | null {
  const command = asText(input.command);
  if (!command) return null;
  const manifestStart = readManifestStart(input.manifest);
  const manifestCommand = manifestStart?.command || '';
  if (manifestCommand && normalizePreviewServiceCommand(manifestCommand) === normalizePreviewServiceCommand(command)) {
    const fixedShell = isOneCeoFixedShellCommand(manifestCommand);
    return {
      command,
      port:
        extractPreviewServicePort(command) ||
        manifestStart?.port ||
        (fixedShell ? ONECEO_FIXED_SHELL_DEFAULT_PORT : getDefaultPortForScript('start', manifestCommand)),
      healthPath: manifestStart?.healthPath || (fixedShell ? ONECEO_FIXED_SHELL_HEALTH_PATH : undefined),
      source: 'manifest',
      appendVitePortArgs: isViteLikeScript('start', manifestCommand),
      persistent: fixedShell || isViteLikeScript('start', manifestCommand),
    };
  }

  if (isOneCeoFixedShellCommand(command)) {
    return {
      command,
      port: extractPreviewServicePort(command) || ONECEO_FIXED_SHELL_DEFAULT_PORT,
      healthPath: readHealthPath(input.manifest) || ONECEO_FIXED_SHELL_HEALTH_PATH,
      source: 'oneceo_fixed_shell',
      persistent: true,
    };
  }

  if (isPackageStartCommand(command)) {
    const scripts = asRecord(input.packageJson?.scripts);
    const startCommand = asText(scripts.start);
    if (!startCommand) return null;
    const fixedShell = isOneCeoFixedShellCommand(startCommand);
    if (!fixedShell && !isViteLikeScript('start', startCommand)) return null;
    const manifestStart = readManifestStart(input.manifest);
    return {
      command,
      port:
        extractPreviewServicePort(command) ||
        extractPreviewServicePort(startCommand) ||
        manifestStart?.port ||
        (fixedShell ? ONECEO_FIXED_SHELL_DEFAULT_PORT : getDefaultPortForScript('start', startCommand)),
      healthPath: readHealthPath(input.manifest) || (fixedShell ? ONECEO_FIXED_SHELL_HEALTH_PATH : undefined),
      source: fixedShell ? 'oneceo_fixed_shell' : 'package_script',
      appendVitePortArgs: isViteLikeScript('start', startCommand),
      persistent: true,
    };
  }

  return null;
}

export function resolvePreviewServiceCandidate(input: {
  manifest?: Record<string, unknown> | null;
  packageJson?: Record<string, unknown> | null;
}): PreviewServiceContract | null {
  const manifestStart = readManifestStart(input.manifest);
  if (manifestStart?.command) {
    const fixedShell = isOneCeoFixedShellCommand(manifestStart.command);
    return {
      command: manifestStart.command,
      port:
        extractPreviewServicePort(manifestStart.command) ||
        manifestStart.port ||
        (fixedShell ? ONECEO_FIXED_SHELL_DEFAULT_PORT : getDefaultPortForScript('start', manifestStart.command)),
      healthPath: manifestStart.healthPath || (fixedShell ? ONECEO_FIXED_SHELL_HEALTH_PATH : undefined),
      source: 'manifest',
      appendVitePortArgs: isViteLikeScript('start', manifestStart.command),
      persistent: fixedShell || isViteLikeScript('start', manifestStart.command),
    };
  }

  const scripts = asRecord(input.packageJson?.scripts);
  const manager = input.packageJson ? inferPackageManager(input.packageJson) : 'npm';
  for (const scriptName of ['start', 'dev', 'preview']) {
    const scriptCommand = asText(scripts[scriptName]);
    if (!scriptCommand) continue;
    const fixedShell = isOneCeoFixedShellCommand(scriptCommand);
    return {
      command: buildScriptCommand(manager, scriptName),
      port:
        extractPreviewServicePort(scriptCommand) ||
        (fixedShell ? ONECEO_FIXED_SHELL_DEFAULT_PORT : getDefaultPortForScript(scriptName, scriptCommand)),
      healthPath: readHealthPath(input.manifest) || (fixedShell ? ONECEO_FIXED_SHELL_HEALTH_PATH : undefined),
      source: fixedShell ? 'oneceo_fixed_shell' : 'package_script',
      appendVitePortArgs: isViteLikeScript(scriptName, scriptCommand),
      persistent: fixedShell || isViteLikeScript(scriptName, scriptCommand),
    };
  }

  return null;
}
