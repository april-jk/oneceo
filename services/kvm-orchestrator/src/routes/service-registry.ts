import { mockKvmAdapter } from '../adapters/mock-kvm-adapter';
import { KvmOrchestratorService } from '../services/kvm-orchestrator-service';

export const service = new KvmOrchestratorService(mockKvmAdapter);
