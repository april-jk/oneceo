import type { VmRecord, VmLifecycleState } from '../types';

export interface KvmAdapter {
  createVm(vm: VmRecord): Promise<void>;
  startVm(vm: VmRecord): Promise<{ state: VmLifecycleState; ipAddress?: string }>;
  stopVm(vm: VmRecord, force?: boolean): Promise<{ state: VmLifecycleState }>;
  deleteVm(vm: VmRecord): Promise<void>;
  resizeVm(vm: VmRecord, next: { cpuCores?: number; memoryMb?: number; rootDiskGb?: number }): Promise<void>;
}
