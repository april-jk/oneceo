import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const sessionId = process.argv[2] || process.env.OSAC_FIXED_SANDBOX_SESSION_ID;
if (!sessionId) throw new Error('missing session id');

(async () => {
  const { osacAgentService } = await import('../src/services/osac-agent-service');
  await osacAgentService.closeConnection(sessionId);
  console.log('closed', sessionId);
})();
