import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const sid = process.argv[2] || process.env.OSAC_FIXED_SANDBOX_SESSION_ID;
if (!sid) throw new Error('sid required');

async function main() {
  const { sandboxExecutionEnvironmentDAO } = await import('../src/db/dao');
  const env = await sandboxExecutionEnvironmentDAO.getBySessionId(sid);
  console.log(JSON.stringify(env, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  process.exit(1);
});
