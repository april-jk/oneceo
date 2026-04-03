import { codexRemoteService } from './codex-remote-service';
import { opencodeRemoteService } from './opencode-remote-service';

export type SandboxExecutor = 'opencode' | 'codex' | 'claudecode';

export type SandboxExecutorInput = {
  taskSessionId: string;
  content: string;
  orchestratorSessionId?: string;
  workspacePath?: string;
  source?: 'user' | 'agent';
  clientMessageKey?: string;
  metadata?: Record<string, unknown>;
};

export type SandboxExecutorAccepted = {
  executor: SandboxExecutor;
  orchestratorSessionId: string;
  executorSessionId: string;
  opencodeSessionId?: string;
};

function normalizeExecutor(value: unknown): SandboxExecutor {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (normalized === 'codex') return 'codex';
  if (normalized === 'claudecode') return 'claudecode';
  return 'opencode';
}

export class SandboxExecutorRegistry {
  resolveExecutor(value: unknown): SandboxExecutor {
    return normalizeExecutor(value);
  }

  async sendUserInput(executorValue: unknown, input: SandboxExecutorInput): Promise<SandboxExecutorAccepted> {
    const executor = normalizeExecutor(executorValue);
    switch (executor) {
      case 'opencode': {
        const accepted = await opencodeRemoteService.sendUserInput(input);
        return {
          executor,
          orchestratorSessionId: accepted.orchestratorSessionId,
          executorSessionId: accepted.opencodeSessionId,
          opencodeSessionId: accepted.opencodeSessionId,
        };
      }
      case 'codex': {
        const accepted = await codexRemoteService.sendUserInput(input);
        return {
          executor,
          orchestratorSessionId: accepted.orchestratorSessionId,
          executorSessionId: accepted.executorSessionId,
          opencodeSessionId: accepted.executorSessionId,
        };
      }
      case 'claudecode':
        throw new Error('ClaudeCode 直通链路尚未接入');
      default:
        throw new Error(`不支持的 executor: ${String(executorValue || '')}`);
    }
  }
}

export const sandboxExecutorRegistry = new SandboxExecutorRegistry();
