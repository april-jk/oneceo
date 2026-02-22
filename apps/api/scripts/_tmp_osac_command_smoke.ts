import { osacAgentService } from '../src/services/osac-agent-service';

const sessionId = process.env.OSAC_FIXED_SANDBOX_SESSION_ID || 'sess_4471f12d0bc444d3';

async function main() {
  const command = 'echo OSAC_COMMAND_OK';
  const result = await osacAgentService.executeCommandAndWait(
    sessionId,
    { command },
    { timeoutMs: 120000, pollMs: 2000 }
  );
  console.log('[osac-command-smoke]', result.status);
  console.log(result.output || '(no output)');
}

main().catch((err) => {
  console.error('[osac-command-smoke] failed', err);
  process.exit(1);
});
