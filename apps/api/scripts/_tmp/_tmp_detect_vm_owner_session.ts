import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const vmName = process.env.OSAC_FIXED_SANDBOX_VM_NAME || 'test_session_manual_use';

function pickString(...values: any[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

(async () => {
  const { kvmConnector } = await import('../src/connectors/kvm-connector');
  const created = await kvmConnector.createSession({ metadata: { purpose: 'detect-vm-owner' } });
  const sessionData: any = created.data || {};
  const newSessionId = pickString(sessionData.sessionId, sessionData.session_id, sessionData.id, sessionData.session);
  console.log('[detect] new session', newSessionId);
  if (!newSessionId) return;
  try {
    const bind = await kvmConnector.bindSessionVm(newSessionId, { vm_name: vmName });
    console.log('[detect] bind ok', JSON.stringify(bind.data ?? bind, null, 2));
  } catch (error: any) {
    const code = String(error?.code || '').toUpperCase();
    const details = error?.details || {};
    console.error('[detect] bind error', error?.message || String(error));
    console.error('[detect] code', code);
    console.error('[detect] details', JSON.stringify(details, null, 2));
    const owner = pickString(details.owner_session_id, details.ownerSessionId, details.session_id, details.sessionId);
    if (owner) {
      console.log('[detect] owner_session_id', owner);
    }
  }
  try {
    await kvmConnector.closeSession(newSessionId, { graceful_shutdown: true });
  } catch {
    // ignore
  }
})();
