import dotenv from 'dotenv';
import { sandboxAgentProvisionService } from '../src/services/sandbox-agent-provision-service';
import { osacConnector } from '../src/connectors/osac-connector';

dotenv.config({ path: 'apps/api/.env' });

async function run() {
  console.log('OSAC end-to-end test: start');
  const result = await sandboxAgentProvisionService.provision({
    metadata: { owner: 'codex-test', purpose: 'e2e-osac' },
    idempotencyKey: `osac-e2e-${Date.now()}`,
  });

  console.log('Provision result:', result);

  if (!result.osacEndpoint) {
    console.error('No osacEndpoint returned; cannot continue test.');
    return;
  }

  const handle = await osacConnector.connectForSession(result.sessionId);
  console.log('Connected to OSAC. Sending GET_SESSION_LIST...');

  const reply = await handle.request({
    type: 'GET_SESSION_LIST',
    payload: { maxCount: 1, format: 'json' },
  }, (msg) => msg.type === 'SESSION_LIST_RESPONSE');

  console.log('OSAC reply:', reply);
  handle.close();
  console.log('OSAC end-to-end test: done');
}

run().catch((err) => {
  console.error('OSAC end-to-end test failed:', err);
  process.exitCode = 1;
});
