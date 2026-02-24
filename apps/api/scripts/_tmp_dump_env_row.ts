import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

(async () => {
  const { sandboxExecutionEnvironmentDAO } = await import('../src/db/dao');
  const row = await sandboxExecutionEnvironmentDAO.getBySessionId('sess_2268662a2c624117');
  console.log(JSON.stringify(row, null, 2));
})();
