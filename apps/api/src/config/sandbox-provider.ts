export type SandboxProvider = 'e2b' | 'kvm';

export function resolveSandboxProvider(): SandboxProvider {
  const raw = (process.env.SANDBOX_PROVIDER || 'e2b').trim().toLowerCase();
  return raw === 'kvm' ? 'kvm' : 'e2b';
}
