import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

if (!process.env.OSAC_OPERATION_CONNECT_ACQUIRE_TIMEOUT_MS) {
  process.env.OSAC_OPERATION_CONNECT_ACQUIRE_TIMEOUT_MS = '12000';
}
if (!process.env.OSAC_REQUEST_TIMEOUT_MS) {
  process.env.OSAC_REQUEST_TIMEOUT_MS = '12000';
}

const sessionId = process.argv[2] || process.env.OSAC_FIXED_SANDBOX_SESSION_ID;
if (!sessionId) {
  throw new Error('missing OSAC session id');
}

const root = process.argv[3] || process.env.OPENCODE_TASK_WORKSPACE_ROOT || '/opt/.altus/opencode/workspaces';

async function listDir(
  osacAgentService: any,
  workspaceRoot: string,
  path: string
) {
  const resp = await osacAgentService.opencodeHttpRequest(sessionId, {
    method: 'GET',
    path: '/file',
    query: { path },
    workspacePath: workspaceRoot,
  });
  const body = typeof resp.body === 'string' ? resp.body : '';
  return JSON.parse(body || '[]');
}

async function readFile(
  osacAgentService: any,
  workspaceRoot: string,
  filePath: string
) {
  const resp = await osacAgentService.opencodeHttpRequest(sessionId, {
    method: 'GET',
    path: '/file/content',
    query: { path: filePath },
    workspacePath: workspaceRoot,
  });
  const body = typeof resp.body === 'string' ? resp.body : '';
  return JSON.parse(body || '{}');
}

(async () => {
  const { osacAgentService } = await import('../src/services/osac-agent-service');

  console.log('[probe] sessionId', sessionId);
  console.log('[probe] root', root);

  console.log('[probe] ensure opencode server');
  await osacAgentService.ensureOpencodeServer(sessionId, { workspacePath: root });
  console.log('[probe] ensure done');

  const workspaceDirs = await listDir(osacAgentService, root, '');
  const firstDir = workspaceDirs.find((item: any) => item && item.type === 'directory');
  if (!firstDir) {
    console.log('[probe] no workspace directory found under', root);
    return;
  }

  const workspaceRoot = `${root}/${firstDir.path}`;
  console.log('[probe] workspaceRoot', workspaceRoot);

  const entries = await listDir(osacAgentService, workspaceRoot, '');
  console.log('[probe] entries', entries.length);

  const firstFile = entries.find((item: any) => item && item.type === 'file');
  if (!firstFile) {
    console.log('[probe] no file found in workspace', workspaceRoot);
    return;
  }

  const content = await readFile(osacAgentService, workspaceRoot, firstFile.path);
  const text = typeof content.content === 'string' ? content.content : '';
  console.log('[probe] file', firstFile.path, 'type', content.type, 'size', text.length);
  console.log('[probe] sample', text.slice(0, 200));
})();
