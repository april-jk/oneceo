import path from 'path';

export interface OsacBootstrapConfig {
  osacPort: number;
  osacPathSuffix: string;
  osacBinaryPath: string;
  opencodeBinaryPath: string;
  deliveryMode: 'file-drop' | 'guest-agent';
  remoteBaseDir: string;
  osacBinaryName: string;
  opencodeBinaryName: string;
  launchCommand: string | null;
  downloadBaseUrl?: string;
  binaryAuthToken?: string;
  connectionMode: 'direct' | 'port-mapping' | 'kvm-tcp-relay';
  portMappingBase?: number;
  portMappingRange?: number;
  portMappingHost?: string;
}

function toNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function resolvePath(input: string, fallback: string) {
  const raw = input || fallback;
  return path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
}

export const osacBootstrapConfig: OsacBootstrapConfig = {
  osacPort: toNumber(process.env.OSAC_PORT, 18080),
  osacPathSuffix: process.env.OSAC_PATH_SUFFIX || '/ws',
  osacBinaryPath: resolvePath(
    process.env.OSAC_BINARY_PATH || '',
    'others/osac-linux/osac-linux-amd64_v1.1.3'
  ),
  opencodeBinaryPath: resolvePath(
    process.env.OPENCODE_BINARY_PATH || '',
    'others/opencode/opencode'
  ),
  deliveryMode:
    (process.env.OSAC_FILE_DELIVERY_MODE as 'file-drop' | 'guest-agent') || 'guest-agent',
  remoteBaseDir: process.env.OSAC_REMOTE_BASE_DIR || '/opt/.altus/opencode',
  osacBinaryName: process.env.OSAC_REMOTE_OSAC_NAME || 'osac',
  opencodeBinaryName: process.env.OSAC_REMOTE_OPENCODE_NAME || 'opencode',
  launchCommand: process.env.OSAC_LAUNCH_COMMAND || null,
  downloadBaseUrl: process.env.OSAC_DOWNLOAD_BASE_URL,
  binaryAuthToken: process.env.OSAC_BINARY_TOKEN || undefined,
  connectionMode:
    (process.env.OSAC_CONNECTION_MODE as 'direct' | 'port-mapping' | 'kvm-tcp-relay') || 'direct',
  portMappingBase: process.env.OSAC_PORT_MAPPING_BASE
    ? Number(process.env.OSAC_PORT_MAPPING_BASE)
    : undefined,
  portMappingRange: process.env.OSAC_PORT_MAPPING_RANGE
    ? Number(process.env.OSAC_PORT_MAPPING_RANGE)
    : undefined,
  portMappingHost: process.env.OSAC_PORT_MAPPING_HOST || undefined,
};
