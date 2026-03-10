import dotenv from 'dotenv';
dotenv.config({ path: '.env' });

const sid = process.env.SID;
if (!sid) throw new Error('SID required');

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const { sandboxExecutionEnvironmentDAO } = await import('../src/db/dao');
  const { osacConnector } = await import('../src/connectors/osac-connector');
  const { kvmConnector } = await import('../src/connectors/kvm-connector');

  const env = await sandboxExecutionEnvironmentDAO.getBySessionId(sid);
  const metadata = (env?.metadata || {}) as any;
  console.log('session=', sid);
  console.log('endpoint=', metadata.osacEndpoint || null);
  console.log('token=', metadata.osacAuthToken || null);

  const exec = async (cmd: string) => {
    const r = await kvmConnector.execSession(sid, {
      path: '/bin/bash',
      args: ['-lc', cmd],
      capture_output: true,
      timeout_seconds: 45,
    });
    const jobId = (r as any)?.data?.jobId || (r as any)?.data?.job_id || (r as any)?.jobId || (r as any)?.job_id;
    let fin: any = r;
    if (jobId) {
      for (let i = 0; i < 50; i++) {
        const j = await kvmConnector.getJob(String(jobId));
        const s = (j as any)?.data?.status;
        if (s && s !== 'queued' && s !== 'running') {
          fin = j;
          break;
        }
        await sleep(1000);
      }
    }
    const payload = (fin as any)?.data?.result || (fin as any)?.data || {};
    return String(payload.stdout || payload.output || '').replace(/\s+/g, ' ').trim();
  };

  console.log('vmToken=', await exec("echo 'etc:'; grep '^OSAC_AUTH_TOKEN=' /etc/environment || true; echo 'proc:'; PID=$(pgrep -o osac || true); if [ -n \"$PID\" ]; then tr '\\0' '\\n' < /proc/$PID/environ | grep '^OSAC_AUTH_TOKEN=' || true; else echo NO_OSAC; fi"));

  for (let i = 1; i <= 6; i++) {
    try {
      const handle = await osacConnector.connectForSession(sid);
      console.log(`connectAttempt${i}=ok`);
      handle.close();
      break;
    } catch (e: any) {
      console.log(`connectAttempt${i}=fail`, e?.message || String(e));
      await sleep(5000);
    }
  }

  console.log('osacLog=', await exec('tail -n 80 /opt/.altus/opencode/log/osac.log 2>/dev/null || true'));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
