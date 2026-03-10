export interface SandboxSecurityConfig {
  protectedVmNames: string[];
  baseImageName: string;
  sandboxBaseImagePath?: string;
  sandboxNetwork?: string;
  sandboxMemoryMb?: number;
  sandboxVcpus?: number;
  sandboxOsVariant?: string;
  incrementalStorageDir: string;
  denyCidrs: string[];
  allowedDomains: string[];
  enforceSessionFirst: boolean;
  envOpenMaxAttempts: number;
  useSandboxApi: boolean;
}

function parseCsv(value: string | undefined, fallback: string[]): string[] {
  if (!value) return fallback;
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export const sandboxSecurityConfig: SandboxSecurityConfig = {
  protectedVmNames: parseCsv(process.env.KVM_PROTECTED_VM_NAMES, [
    'server2019_forTest',
    'ssh_AND_telnet_test_Server',
  ]),
  baseImageName: process.env.KVM_BASE_IMAGE_NAME || 'altus-base-ubuntu22-lts',
  sandboxBaseImagePath: process.env.KVM_SANDBOX_BASE_IMAGE || undefined,
  sandboxNetwork: process.env.KVM_SANDBOX_NETWORK || 'sandbox-net',
  sandboxMemoryMb: process.env.KVM_SANDBOX_MEMORY_MB ? Number(process.env.KVM_SANDBOX_MEMORY_MB) : 2048,
  sandboxVcpus: process.env.KVM_SANDBOX_VCPUS ? Number(process.env.KVM_SANDBOX_VCPUS) : 2,
  sandboxOsVariant: process.env.KVM_SANDBOX_OS_VARIANT || 'ubuntu22.04',
  incrementalStorageDir:
    process.env.KVM_INCREMENTAL_STORAGE_DIR || '/var/lib/libvirt/images/incremental',
  denyCidrs: parseCsv(process.env.KVM_SANDBOX_DENY_CIDRS, [
    '10.0.0.0/8',
    '172.16.0.0/12',
    '192.168.0.0/16',
  ]),
  allowedDomains: parseCsv(process.env.KVM_SANDBOX_ALLOWED_DOMAINS, []),
  enforceSessionFirst: (process.env.KVM_ENFORCE_SESSION_FIRST || 'true').toLowerCase() !== 'false',
  envOpenMaxAttempts: Math.max(1, Number(process.env.KVM_ENV_OPEN_MAX_ATTEMPTS || 3)),
  useSandboxApi: (process.env.KVM_USE_SANDBOX_API || 'true').toLowerCase() !== 'false',
};
