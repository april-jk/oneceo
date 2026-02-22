import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const sid = process.argv[2];
if (!sid) throw new Error('sid required');

(async()=>{
  const { osacConnectionManager } = await import('../src/services/osac-connection-manager');
  await osacConnectionManager.close(sid);
  console.log('closed');
  const timeoutMs = 20000;
  const ok = await Promise.race([
    osacConnectionManager.ensurePersistent(sid),
    new Promise<boolean>((_resolve, reject) =>
      setTimeout(() => reject(new Error(`ensurePersistent timeout after ${timeoutMs}ms`)), timeoutMs)
    ),
  ]);
  console.log('ensurePersistent=', ok);
})();
