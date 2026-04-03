export interface OsacBootstrapConfig {
  osacPort: number;
  osacPathSuffix: string;
  remoteBaseDir: string;
  osacBinaryName: string;
  opencodeBinaryName: string;
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

export const osacBootstrapConfig: OsacBootstrapConfig = {
  osacPort: toNumber(process.env.OSAC_PORT, 18080),
  osacPathSuffix: process.env.OSAC_PATH_SUFFIX || '/ws',
  remoteBaseDir: process.env.OSAC_REMOTE_BASE_DIR || '/opt/.altus/opencode',
  osacBinaryName: process.env.OSAC_REMOTE_OSAC_NAME || 'osac',
  opencodeBinaryName: process.env.OSAC_REMOTE_OPENCODE_NAME || 'opencode',
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
