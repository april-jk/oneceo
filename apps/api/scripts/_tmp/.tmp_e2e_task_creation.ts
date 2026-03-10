import { TaskCreationService } from './src/agents/task-creation/task-creation-service';

async function main() {
  const service = new TaskCreationService({
    onMessage: (message) => {
      const brief = message.content ? String(message.content).slice(0, 200) : '';
      console.log(`[MSG] ${message.type} ${message.agent || ''} ${brief}`);
    },
    onAskUser: async (question, options) => {
      console.log(`[ASK] ${question} ${options ? JSON.stringify(options) : ''}`);
      return '';
    },
    onSessionCreated: (sessionId) => {
      console.log(`[SESSION] ${sessionId}`);
    },
  });

  await service.createTask('创建2048小游戏，使用html即可', 'codex-e2e');
  console.log('task creation finished');
  setTimeout(() => process.exit(0), 2000);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
