import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const sid = process.env.OSAC_FIXED_SANDBOX_SESSION_ID || 'sess_35ff684915754d7c';
const vmName = process.env.OSAC_FIXED_SANDBOX_VM_NAME || 'test_session_manual_use';

async function main() {
  const { kvmConnector } = await import('../src/connectors/kvm-connector');
  console.log('[check] session', sid, 'vm', vmName);
  try {
    const session = await kvmConnector.getSession(sid);
    console.log('[check] getSession ok', JSON.stringify(session.data ?? session, null, 2));
  } catch (err) {
    console.error('[check] getSession error', err instanceof Error ? err.message : err);
  }
  try {
    const vm = await kvmConnector.getSessionVm(sid);
    console.log('[check] getSessionVm ok', JSON.stringify(vm.data ?? vm, null, 2));
  } catch (err) {
    console.error('[check] getSessionVm error', err instanceof Error ? err.message : err);
  }
  try {
    const sandbox = await kvmConnector.getSandbox(sid);
    console.log('[check] getSandbox ok', JSON.stringify(sandbox.data ?? sandbox, null, 2));
  } catch (err) {
    console.error('[check] getSandbox error', err instanceof Error ? err.message : err);
  }

  try {
    const vm = await kvmConnector.getVm(vmName);
    console.log('[check] getVm ok', JSON.stringify(vm.data ?? vm, null, 2));
  } catch (err) {
    console.error('[check] getVm error', err instanceof Error ? err.message : err);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
