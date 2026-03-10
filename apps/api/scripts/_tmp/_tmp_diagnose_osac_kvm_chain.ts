import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const inputSessions = process.argv.slice(2).filter(Boolean);

if (inputSessions.length === 0) {
  console.error('Usage: pnpm exec tsx scripts/_tmp_diagnose_osac_kvm_chain.ts <sessionId...>');
  process.exit(1);
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitJob(kvmConnector: any, jobId: string, timeoutMs = 180_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const job = await kvmConnector.getJob(jobId);
    const status = String((job as any)?.data?.status || '').toLowerCase();
    if (status && status !== 'queued' && status !== 'running') {
      return job;
    }
    await sleep(1000);
  }
  throw new Error(`job timeout: ${jobId}`);
}

async function execInVm(kvmConnector: any, sessionId: string, command: string, timeoutSeconds = 60) {
  const submit = await kvmConnector.execSession(sessionId, {
    path: '/bin/bash',
    args: ['-lc', command],
    capture_output: true,
    timeout_seconds: timeoutSeconds,
  });
  const jobId =
    (submit as any)?.data?.jobId ||
    (submit as any)?.data?.job_id ||
    (submit as any)?.jobId ||
    (submit as any)?.job_id;

  let final: any = submit;
  if (jobId) {
    final = await waitJob(kvmConnector, String(jobId));
  }
  const payload = (final as any)?.data?.result || (final as any)?.data || final || {};
  return {
    status: String((final as any)?.data?.status || payload.status || 'unknown'),
    exit: payload.exitcode ?? payload.exitCode ?? null,
    stdout: String(payload.stdout || payload.output || ''),
    stderr: String(payload.stderr || ''),
  };
}

function safeTrim(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function maskToken(token: string): string {
  if (!token) return '';
  if (token.length <= 10) return '***';
  return `${token.slice(0, 4)}***${token.slice(-3)}`;
}

async function main() {
  const { sandboxExecutionEnvironmentDAO } = await import('../src/db/dao');
  const { kvmConnector } = await import('../src/connectors/kvm-connector');
  const { osacConnector } = await import('../src/connectors/osac-connector');

  const reports: any[] = [];

  for (const sid of inputSessions) {
    const report: any = {
      sessionId: sid,
      db: {},
      kvm: {},
      vm: {},
      ws: {},
    };

    const envRow: any = await sandboxExecutionEnvironmentDAO.getBySessionId(sid);
    const md = ((envRow?.metadata || {}) as Record<string, unknown>) || {};
    const dbToken = safeTrim(md.osacAuthToken);
    report.db = {
      status: envRow?.status || null,
      warmState: ((md.warmPool as any)?.state || null),
      osacEndpoint: md.osacEndpoint || null,
      osacHostPort: md.osacHostPort || null,
      vmIpAddress: md.vmIpAddress || null,
      osacTokenMask: maskToken(dbToken),
      osacTokenLen: dbToken ? dbToken.length : null,
    };

    try {
      const ports = await kvmConnector.listSandboxPorts(sid, {});
      report.kvm = {
        ok: true,
        ports: ports?.data || null,
      };
    } catch (error) {
      report.kvm = {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    try {
      const vmCmd = [
        "echo '---token_etc---'",
        "grep '^OSAC_AUTH_TOKEN=' /etc/environment || true",
        "echo '---token_proc---'",
        "PID=$(pgrep -o osac || true); if [ -n \"$PID\" ]; then tr '\\0' '\\n' </proc/$PID/environ | grep '^OSAC_AUTH_TOKEN=' || true; else echo NO_OSAC_PID; fi",
        "echo '---listen---'",
        "if command -v ss >/dev/null 2>&1; then ss -ltnp | grep -E ':18080|:18111' || true; else netstat -ltnp | grep -E ':18080|:18111' || true; fi",
        "echo '---models---'",
        "curl -sS -m 40 http://127.0.0.1:18111/v1/models -H 'Authorization: Bearer local-proxy' || true",
        "echo '---log---'",
        "tail -n 40 /opt/.altus/opencode/log/osac.log 2>/dev/null || true",
      ].join('; ');
      const vmRes = await execInVm(kvmConnector, sid, vmCmd, 90);
      report.vm = {
        ok: true,
        status: vmRes.status,
        exit: vmRes.exit,
        stdout: vmRes.stdout.slice(0, 5000),
        stderr: vmRes.stderr.slice(0, 800),
      };
    } catch (error) {
      report.vm = {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    try {
      const handle = await osacConnector.connectForSession(sid);
      try {
        await handle.ping(5000);
      } catch {
        // keep connected result even if ping fails
      }
      report.ws = {
        ok: true,
        endpoint: handle.endpoint,
      };
      try {
        handle.close();
      } catch {
        // ignore
      }
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      report.ws = {
        ok: false,
        error: text,
      };
    }

    reports.push(report);
  }

  console.log(JSON.stringify({ at: new Date().toISOString(), reports }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});

