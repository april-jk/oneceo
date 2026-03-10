import '../config/env';
import { osacAgentService } from '../services/osac-agent-service';

async function main() {
  const orchestratorSessionId = process.argv[2];
  const opencodeSessionId = process.argv[3];
  if (!orchestratorSessionId || !opencodeSessionId) {
    console.error('usage: tsx e2b-opencode-session-details.ts <orchestratorSessionId> <opencodeSessionId>');
    process.exit(1);
  }
  const data = await osacAgentService.getSessionDetails(orchestratorSessionId, opencodeSessionId);
  console.log(JSON.stringify(data, null, 2));
}

main().catch((error) => {
  console.error('[details] failed:', error);
  process.exit(1);
});
