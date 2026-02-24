import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

(async () => {
  const { sandboxExecutionEnvironmentDAO } = await import('../src/db/dao');
  const env = await sandboxExecutionEnvironmentDAO.getBySessionId('sess_4471f12d0bc444d3');
  console.log(JSON.stringify(env, null, 2));
})();
