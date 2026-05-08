import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { e2bConnector } from '../src/connectors/e2b-connector';
import {
  buildOfficialWebShellMaterializationGuidance,
  materializeOfficialWebShellInSandbox,
} from '../src/services/oneceo-official-web-shell-materialization-service';

test('materializeOfficialWebShellInSandbox writes the official scaffold into an empty deployable workspace', async () => {
  const commands: string[] = [];
  const writes: Array<{ path: string; content: string }> = [];

  mock.method(e2bConnector, 'runCommand', async (_sandboxId: string, command: string) => {
    commands.push(command);
    if (command.includes('official_present=')) {
      return {
        stdout: 'stack_detected=0\nofficial_present=0\nnon_ignored_count=0\n',
        stderr: '',
        exitCode: 0,
      } as any;
    }
    return { stdout: '', stderr: '', exitCode: 0 } as any;
  });
  mock.method(e2bConnector, 'writeFile', async (_sandboxId: string, filePath: string, data: Uint8Array | Buffer) => {
    writes.push({
      path: filePath,
      content: Buffer.from(data).toString('utf-8'),
    });
  });

  try {
    const result = await materializeOfficialWebShellInSandbox({
      sandboxId: 'sandbox-1',
      workspaceRoot: '/workspace/session-1',
      taskIntentProfile: {
        mode: 'deployable_web_app',
        reason: 'latest_deployable_request',
        recentUserMessages: ['帮我生成一个企业官网'],
        explicitNoDeploy: false,
        explicitNoWeb: false,
        webArtifactRequested: true,
        deployRequested: true,
        scriptArtifactRequested: false,
        emailTemplateRequested: false,
        deploymentAllowed: true,
        needsClarification: false,
        clarificationQuestion: '',
        clarificationType: 'none',
        todoRequired: false,
        todoReason: 'none',
      },
    });

    assert.equal(result.applied, true);
    assert.equal(result.reason, 'materialized');
    assert.ok(commands.some((command) => command.includes('mkdir -p')));
    assert.ok(writes.some((item) => item.path.endsWith('/client/index.html')));
    assert.ok(writes.some((item) => item.path.endsWith('/client/src/App.jsx')));
    assert.ok(writes.some((item) => item.path.endsWith('/server/index.ts')));
    assert.ok(writes.some((item) => item.path.endsWith('/package.json') && item.content.includes('"start": "node dist/index.js"')));
    assert.ok(writes.some((item) => item.path.endsWith('/oneceo.manifest.json') && item.content.includes('"stack": "oneceo_fixed_vite_node_shell"')));
  } finally {
    mock.restoreAll();
  }
});

test('materializeOfficialWebShellInSandbox skips existing stack workspaces', async () => {
  mock.method(e2bConnector, 'runCommand', async () => {
    return {
      stdout: 'stack_detected=1\nofficial_present=0\nnon_ignored_count=1\n',
      stderr: '',
      exitCode: 0,
    } as any;
  });
  const writeMock = mock.method(e2bConnector, 'writeFile', async () => undefined);

  try {
    const result = await materializeOfficialWebShellInSandbox({
      sandboxId: 'sandbox-2',
      workspaceRoot: '/workspace/session-2',
      taskIntentProfile: {
        mode: 'deployable_web_app',
        reason: 'latest_deployable_request',
        recentUserMessages: ['继续修复当前 React 项目'],
        explicitNoDeploy: false,
        explicitNoWeb: false,
        webArtifactRequested: true,
        deployRequested: true,
        scriptArtifactRequested: false,
        emailTemplateRequested: false,
        deploymentAllowed: true,
        needsClarification: false,
        clarificationQuestion: '',
        clarificationType: 'none',
        todoRequired: false,
        todoReason: 'none',
      },
    });

    assert.equal(result.applied, false);
    assert.equal(result.reason, 'stack_detected');
    assert.equal(writeMock.mock.callCount(), 0);
  } finally {
    mock.restoreAll();
  }
});

test('buildOfficialWebShellMaterializationGuidance tells Altus to edit within the scaffold', () => {
  const guidance = buildOfficialWebShellMaterializationGuidance();

  assert.match(guidance, /官方固定网站模板已经预置/);
  assert.match(guidance, /不要重新发明技术栈/);
  assert.match(guidance, /client\/src\/App\.jsx/);
  assert.match(guidance, /build\/start\/healthcheck\/analytics/);
});
