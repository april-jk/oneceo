import dotenv from 'dotenv';
dotenv.config({ path: '.env' });
const { sandboxAgentProvisionService } = await import('../src/services/sandbox-agent-provision-service');
const status = await sandboxAgentProvisionService.getWarmPoolStatus();
console.log(JSON.stringify(status, null, 2));
