import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const sessionId = process.argv[2] || process.env.OSAC_FIXED_SANDBOX_SESSION_ID;
if (!sessionId) throw new Error('missing session id');

(async () => {
  const { osacAgentService } = await import('../src/services/osac-agent-service');
  console.log('[probe] session', sessionId);
  console.log('[probe] send http /file');
  const resp = await osacAgentService.opencodeHttpRequest(sessionId, {
    method: 'GET',
    path: '/file',
    query: { path: '' },
    workspacePath: process.env.OPENCODE_TASK_WORKSPACE_ROOT || '/opt/.altus/opencode/workspaces',
  });
  console.log('[probe] status', resp.status);
  console.log('[probe] body_len', typeof resp.body === 'string' ? resp.body.length : -1);
})();
