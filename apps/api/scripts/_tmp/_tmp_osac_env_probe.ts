import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const sessionId = process.argv[2] || process.env.OSAC_FIXED_SANDBOX_SESSION_ID;
if (!sessionId) {
  throw new Error('missing session id');
}

(async () => {
  const { sandboxExecutionEnvironmentDAO } = await import('../src/db/dao');
  const env = await sandboxExecutionEnvironmentDAO.getBySessionId(sessionId);
  console.log('session', sessionId);
  console.log('env exists', Boolean(env));
  console.log('metadata', JSON.stringify(env?.metadata || {}, null, 2));
})();
