import type { KvmAdapter } from './kvm-adapter';
import type { VmRecord, VmLifecycleState } from '../types';

export class MockKvmAdapter implements KvmAdapter {
  async createVm(_vm: VmRecord): Promise<void> {
    return;
  }

  async startVm(_vm: VmRecord): Promise<{ state: VmLifecycleState; ipAddress?: string }> {
    const random = Math.floor(Math.random() * 150) + 50;
    return {
      state: 'running',
      ipAddress: `192.168.122.${random}`,
    };
  }

  async stopVm(_vm: VmRecord, _force?: boolean): Promise<{ state: VmLifecycleState }> {
    return { state: 'stopped' };
  }

  async deleteVm(_vm: VmRecord): Promise<void> {
    return;
  }

  async resizeVm(_vm: VmRecord, _next: { cpuCores?: number; memoryMb?: number; rootDiskGb?: number }): Promise<void> {
    return;
  }
}

export const mockKvmAdapter = new MockKvmAdapter();
