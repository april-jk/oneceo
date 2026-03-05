import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const taskSessionId = process.argv[2] || '53523b84-48d9-427a-9252-7158ff856a1b';
const oldOrchSessionId = process.argv[3] || 'sess_4471f12d0bc444d3';
const vmName = process.argv[4] || 'test_session_manual_use';

function pickString(...values: any[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

(async () => {
  const { kvmConnector } = await import('../src/connectors/kvm-connector');
  const { sandboxExecutionEnvironmentDAO } = await import('../src/db/dao');
  const { sandboxEnvironmentService } = await import('../src/services/sandbox-environment-service');
  const { taskCreationFileMemoryStore } = await import('../src/agents/task-creation/file-memory-store');

  console.log('[rebind] taskSession', taskSessionId);
  console.log('[rebind] old orchestrator', oldOrchSessionId);

  const oldEnv = await sandboxExecutionEnvironmentDAO.getBySessionId(oldOrchSessionId);
  if (!oldEnv) {
    throw new Error(`old env not found: ${oldOrchSessionId}`);
  }

  const created = await kvmConnector.createSession({ metadata: oldEnv.metadata || {} });
  const sessionData = created.data as any;
  const newSessionId = pickString(sessionData?.sessionId, sessionData?.session_id, sessionData?.id);
  if (!newSessionId) {
    throw new Error('createSession did not return sessionId');
  }
  console.log('[rebind] new orchestrator', newSessionId);

  await kvmConnector.bindSessionVm(newSessionId, { vm_name: vmName });

  const updatedMetadata = {
    ...((oldEnv.metadata || {}) as Record<string, unknown>),
    fixedSandbox: {
      ...(typeof (oldEnv.metadata as any)?.fixedSandbox === 'object' ? (oldEnv.metadata as any).fixedSandbox : {}),
      vmName,
      enabled: true,
      sessionId: newSessionId,
    },
    osacMappingId: `portmap:${newSessionId}:18080`,
    osacMappingEpoch: 1,
    osacConnectionMode: 'kvm-tcp-relay',
  } as Record<string, unknown>;

  await sandboxEnvironmentService.attachPoolEnvironment({
    sessionId: newSessionId,
    vmName,
    metadata: updatedMetadata,
    status: 'ready',
  });

  await taskCreationFileMemoryStore.updateRuntimeBinding(taskSessionId, {
    orchestratorSessionId: newSessionId,
  });

  console.log('[rebind] updated runtime binding for task session');
})();
