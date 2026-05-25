import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { e2bConnector } from '../src/connectors/e2b-connector';
import { sandboxExecutionEnvironmentDAO } from '../src/db/dao';
import {
  __buildNekoStartCommandForTest,
  __buildNekoClientUrlForTest,
  __hasTurnIceServerForTest,
  __parseIceServersForTest,
  __probeChromiumCdpForTest,
  __renderNekoMemberYamlForTest,
  detectIceFailureFromLog,
  ensureNekoDebug,
} from '../src/services/sandbox-debug-service';

test('parse ice servers supports urls string and array', () => {
  const parsed = __parseIceServersForTest(
    JSON.stringify([
      { urls: 'stun:stun.l.google.com:19302' },
      {
        urls: ['turn:turn.example.com:3478?transport=udp', 'turns:turn.example.com:5349?transport=tcp'],
        username: 'user-1',
        credential: 'pass-1',
      },
    ])
  );

  assert.equal(parsed.length, 2);
  assert.deepEqual(parsed[0]?.urls, ['stun:stun.l.google.com:19302']);
  assert.equal(parsed[1]?.username, 'user-1');
  assert.equal(parsed[1]?.credential, 'pass-1');
  assert.equal(__hasTurnIceServerForTest(parsed), true);
});

test('parse ice servers rejects invalid json payload', () => {
  assert.throws(() => __parseIceServersForTest('{bad-json}'), /debug_ice_servers_invalid_json/);
});

test('parse ice servers rejects invalid urls shape', () => {
  assert.throws(
    () => __parseIceServersForTest(JSON.stringify([{ urls: [] }])),
    /debug_ice_servers_invalid_urls/
  );
});

test('turn detector returns false for stun-only config', () => {
  const parsed = __parseIceServersForTest(JSON.stringify([{ urls: ['stun:stun.l.google.com:19302'] }]));
  assert.equal(__hasTurnIceServerForTest(parsed), false);
});

test('ice failure detector matches canonical failure logs', () => {
  const failed = detectIceFailureFromLog(
    [
      '10:50AM WRN Failed to ping without candidate pairs. Connection is not possible yet.',
      '10:50AM INF ICE connection state changed: failed',
    ].join('\n')
  );
  assert.equal(failed, true);

  const ok = detectIceFailureFromLog('10:50AM INF neko ready');
  assert.equal(ok, false);
});

test('ice failure detector ignores transient warning when later connected', () => {
  const log = [
    '10:50AM WRN Failed to ping without candidate pairs. Connection is not possible yet.',
    '10:50AM INF ICE connection state changed: checking',
    '10:50AM INF ICE connection state changed: connected',
  ].join('\n');
  assert.equal(detectIceFailureFromLog(log), false);
});

test('ice failure detector ignores historical failed after recovered connected', () => {
  const log = [
    '10:50AM INF ICE connection state changed: failed',
    '10:51AM INF ICE connection state changed: connected',
  ].join('\n');
  assert.equal(detectIceFailureFromLog(log), false);
});

test('neko debug uses anonymous access without url credentials', () => {
  const memberYaml = __renderNekoMemberYamlForTest();

  assert.match(memberYaml, /provider: "noauth"/);
  assert.doesNotMatch(memberYaml, /multiuser/i);
  assert.doesNotMatch(memberYaml, /password/i);
  assert.equal(__buildNekoClientUrlForTest('https://8081-example.e2b.app'), 'https://8081-example.e2b.app');
});

test('chromium cdp probe checks the managed debugging endpoint', async () => {
  const runCommandMock = mock.method(e2bConnector, 'runCommand', async (_sandboxId, command, options) => {
    assert.match(String(command), /127\.0\.0\.1:9222\/json\/version/);
    assert.equal((options as any)?.timeoutMs, 10000);
    return {
      stdout: 'OK\n',
      stderr: '',
      exitCode: 0,
    } as any;
  });

  assert.equal(await __probeChromiumCdpForTest('sandbox-1', 9222), true);
  assert.equal(runCommandMock.mock.callCount(), 1);
});

test('chromium cdp probe returns false when the endpoint is missing', async () => {
  mock.method(e2bConnector, 'runCommand', async () => ({
    stdout: 'MISSING\n',
    stderr: '',
    exitCode: 0,
  }) as any);

  assert.equal(await __probeChromiumCdpForTest('sandbox-1', 9222), false);
});

test('neko start wrapper writes runtime scripts under debug-browser and uses a lock', () => {
  const command = __buildNekoStartCommandForTest('echo start');

  assert.match(command, /\/tmp\/oneceo\/debug-browser\/neko-start\.sh/);
  assert.match(command, /\/tmp\/oneceo\/debug-browser\/logs\/neko-start\.log/);
  assert.match(command, /\/tmp\/oneceo\/debug-browser\/run\/ensure\.lock/);
  assert.match(command, /flock -E 42 -w 20/);
  assert.match(command, /ensure\.lock\.owner/);
  assert.match(command, /"ownerPid"/);
  assert.match(command, /"runtimeVersion"/);
  assert.match(command, /debug_runtime_ready_after_lock/);
  assert.match(command, /already ready after lock acquisition; skipping restart/);
  assert.match(command, /debug browser lock diagnostic/);
  assert.match(command, /lock_has_live_holder \|\| holder_status=\$\?/);
  assert.match(command, /stale lock suspected/);
  assert.match(command, /retrying once/);
  assert.match(command, /could not be inspected; refusing stale cleanup/);
  assert.match(command, /already ready after lockdir acquisition; skipping restart/);
  assert.doesNotMatch(command, /\/tmp\/oneceo\/neko\.yml/);
});

test('ensure neko debug refreshes ready sandboxes from older runtime versions', async () => {
  const metadataUpdates: Array<Record<string, unknown>> = [];
  let startWrapperCallCount = 0;
  mock.method(sandboxExecutionEnvironmentDAO, 'getBySessionId', async () => ({
    sessionId: 'sandbox-old-runtime',
    status: 'ready',
    metadata: {
      debug: {
        neko: {
          status: 'running',
          configVersion:
            'neko-noauth-v3-edgefill-1280x1008-mode-mux-tcp-8082-udp-8083-epr-off-icelite-off-nat-none-turn-optional',
          runtimeVersion: 'legacy-runtime',
          port: 8081,
          cdpPort: 9222,
          tcpMuxPort: 8082,
          udpMuxPort: 8083,
          webrtcMode: 'mux',
          webrtcEpr: '',
          forceMux: true,
          iceLite: false,
          autoNat: false,
          nat1To1: '',
          authProvider: 'noauth',
        },
      },
    },
  }) as any);
  mock.method(sandboxExecutionEnvironmentDAO, 'updateMetadata', async (_sessionId, metadata) => {
    metadataUpdates.push(metadata as Record<string, unknown>);
    return {} as any;
  });
  mock.method(e2bConnector, 'getSandboxHost', async (_sandboxId, port) => `${port}-sandbox-old-runtime.e2b.app`);
  mock.method(e2bConnector, 'runCommand', async (_sandboxId, command) => {
    const text = String(command);
    if (text.startsWith('bash -lc ')) {
      startWrapperCallCount += 1;
      return { stdout: '', stderr: '', exitCode: 0 } as any;
    }
    if (text.includes('http://127.0.0.1:8081/')) {
      return { stdout: '200', stderr: '', exitCode: 0 } as any;
    }
    if (text.includes('http://127.0.0.1:9222/json/version')) {
      return { stdout: 'OK\n', stderr: '', exitCode: 0 } as any;
    }
    if (text.includes('command -v neko')) {
      return { stdout: 'OK\n', stderr: '', exitCode: 0 } as any;
    }
    throw new Error(`unexpected command: ${text.slice(0, 80)}`);
  });

  const result = await ensureNekoDebug('sandbox-old-runtime', {
    requireTurn: false,
    strictIceCheck: false,
  });

  assert.equal(result.ready, true);
  assert.equal(startWrapperCallCount, 1);
  assert.equal((metadataUpdates.at(-1) as any).debug.neko.runtimeVersion, 'debug-browser-runtime-v1');
});

test('ensure neko debug reconciles stale failed metadata when runtime is already ready', async () => {
  const metadataUpdates: Array<Record<string, unknown>> = [];
  let startWrapperCallCount = 0;
  mock.method(sandboxExecutionEnvironmentDAO, 'getBySessionId', async () => ({
    sessionId: 'sandbox-stale-failed',
    status: 'ready',
    metadata: {
      debug: {
        neko: {
          status: 'failed',
          reasonCode: 'start_script_failed',
          message: 'previous wrapper failure',
          configVersion:
            'neko-noauth-v3-edgefill-1280x1008-mode-mux-tcp-8082-udp-8083-epr-off-icelite-off-nat-none-turn-optional',
          runtimeVersion: 'debug-browser-runtime-v1',
          port: 8081,
          cdpPort: 9222,
          tcpMuxPort: 8082,
          udpMuxPort: 8083,
          webrtcMode: 'mux',
          webrtcEpr: '',
          forceMux: true,
          iceLite: false,
          autoNat: false,
          nat1To1: '',
          authProvider: 'noauth',
        },
      },
    },
  }) as any);
  mock.method(sandboxExecutionEnvironmentDAO, 'updateMetadata', async (_sessionId, metadata) => {
    metadataUpdates.push(metadata as Record<string, unknown>);
    return {} as any;
  });
  mock.method(e2bConnector, 'getSandboxHost', async (_sandboxId, port) => `${port}-sandbox-stale-failed.e2b.app`);
  mock.method(e2bConnector, 'runCommand', async (_sandboxId, command) => {
    const text = String(command);
    if (text.startsWith('bash -lc ')) {
      startWrapperCallCount += 1;
      return { stdout: '', stderr: '', exitCode: 0 } as any;
    }
    if (text.includes('http://127.0.0.1:8081/')) {
      return { stdout: '200', stderr: '', exitCode: 0 } as any;
    }
    if (text.includes('http://127.0.0.1:9222/json/version')) {
      return { stdout: 'OK\n', stderr: '', exitCode: 0 } as any;
    }
    throw new Error(`unexpected command: ${text.slice(0, 80)}`);
  });

  const result = await ensureNekoDebug('sandbox-stale-failed', {
    requireTurn: false,
    strictIceCheck: false,
  });

  assert.equal(result.ready, true);
  assert.equal(result.status, 'running');
  assert.equal(startWrapperCallCount, 0);
  assert.equal((metadataUpdates.at(-1) as any).debug.neko.status, 'running');
  assert.equal((metadataUpdates.at(-1) as any).debug.neko.reasonCode, undefined);
});

test('ensure neko debug treats wrapper failure as ready when live probes and manifest agree', async () => {
  const metadataUpdates: Array<Record<string, unknown>> = [];
  let startWrapperCallCount = 0;
  let cdpProbeCount = 0;
  let nekoProbeCount = 0;
  mock.method(sandboxExecutionEnvironmentDAO, 'getBySessionId', async () => ({
    sessionId: 'sandbox-wrapper-false-negative',
    status: 'ready',
    metadata: {},
  }) as any);
  mock.method(sandboxExecutionEnvironmentDAO, 'updateMetadata', async (_sessionId, metadata) => {
    metadataUpdates.push(metadata as Record<string, unknown>);
    return {} as any;
  });
  mock.method(e2bConnector, 'getSandboxHost', async (_sandboxId, port) => `${port}-sandbox-wrapper-false-negative.e2b.app`);
  mock.method(e2bConnector, 'runCommand', async (_sandboxId, command) => {
    const text = String(command);
    if (text.startsWith('bash -lc ')) {
      startWrapperCallCount += 1;
      const error = new Error('exit status 2') as any;
      error.exitCode = 2;
      error.stdout = '';
      error.stderr = '[neko] debug browser lock diagnostic\n[neko] lock owner file missing\n';
      throw error;
    }
    if (text.includes('http://127.0.0.1:8081/')) {
      nekoProbeCount += 1;
      return { stdout: nekoProbeCount === 1 ? '000' : '200', stderr: '', exitCode: 0 } as any;
    }
    if (text.includes('http://127.0.0.1:9222/json/version')) {
      cdpProbeCount += 1;
      return { stdout: cdpProbeCount === 1 ? 'MISSING\n' : 'OK\n', stderr: '', exitCode: 0 } as any;
    }
    if (text.includes('command -v neko')) {
      return { stdout: 'OK\n', stderr: '', exitCode: 0 } as any;
    }
    if (text.includes('__CFG__')) {
      return {
        stdout: [
          '__CFG__',
          '',
          '__LOG__',
          'neko ready',
          '__CHROMIUM_LOG__',
          'DevTools listening on ws://127.0.0.1:9222/devtools/browser/test',
          '__XVFB_LOG__',
          '',
          '__START_LOG__',
          '',
          '__MANIFEST__',
          '{"runtimeVersion":"debug-browser-runtime-v1","configVersion":"neko-noauth-v3-edgefill-1280x1008-mode-mux-tcp-8082-udp-8083-epr-off-icelite-off-nat-none-turn-optional","status":"running"}',
          '__TREE__',
          'debug browser files',
          '__PORTS__',
          'LISTEN 0 4096 127.0.0.1:9222\nLISTEN 0 4096 0.0.0.0:8081',
        ].join('\n'),
        stderr: '',
        exitCode: 0,
      } as any;
    }
    throw new Error(`unexpected command: ${text.slice(0, 80)}`);
  });

  const result = await ensureNekoDebug('sandbox-wrapper-false-negative', {
    requireTurn: false,
    strictIceCheck: false,
  });

  assert.equal(result.ready, true);
  assert.equal(result.status, 'running');
  assert.equal(startWrapperCallCount, 1);
  assert.equal((metadataUpdates.at(-1) as any).debug.neko.status, 'running');
  assert.equal((metadataUpdates.at(-1) as any).debug.neko.reasonCode, undefined);
});

test('ensure neko debug recovers when Chromium becomes ready after wrapper timeout', async () => {
  const metadataUpdates: Array<Record<string, unknown>> = [];
  let startWrapperCallCount = 0;
  let lateRecoveryCallCount = 0;
  let cdpProbeCount = 0;
  let nekoProbeCount = 0;
  mock.method(sandboxExecutionEnvironmentDAO, 'getBySessionId', async () => ({
    sessionId: 'sandbox-chromium-late-ready',
    status: 'ready',
    metadata: {},
  }) as any);
  mock.method(sandboxExecutionEnvironmentDAO, 'updateMetadata', async (_sessionId, metadata) => {
    metadataUpdates.push(metadata as Record<string, unknown>);
    return {} as any;
  });
  mock.method(e2bConnector, 'getSandboxHost', async (_sandboxId, port) => `${port}-sandbox-chromium-late-ready.e2b.app`);
  mock.method(e2bConnector, 'runCommand', async (_sandboxId, command) => {
    const text = String(command);
    if (text.includes('recovering late-ready chromium')) {
      lateRecoveryCallCount += 1;
      return { stdout: '[neko] recovering late-ready chromium by starting n.eko\n', stderr: '', exitCode: 0 } as any;
    }
    if (text.startsWith('bash -lc ')) {
      startWrapperCallCount += 1;
      const error = new Error('exit status 39') as any;
      error.exitCode = 39;
      error.stdout = '[neko] chromium start failed\n';
      error.stderr = '';
      throw error;
    }
    if (text.includes('http://127.0.0.1:8081/')) {
      nekoProbeCount += 1;
      return { stdout: nekoProbeCount < 4 ? '000' : '200', stderr: '', exitCode: 0 } as any;
    }
    if (text.includes('http://127.0.0.1:9222/json/version')) {
      cdpProbeCount += 1;
      return { stdout: cdpProbeCount === 1 ? 'MISSING\n' : 'OK\n', stderr: '', exitCode: 0 } as any;
    }
    if (text.includes('command -v neko')) {
      return { stdout: 'OK\n', stderr: '', exitCode: 0 } as any;
    }
    if (text.includes('__CFG__')) {
      return {
        stdout: [
          '__CFG__',
          '',
          '__LOG__',
          'neko ready',
          '__CHROMIUM_LOG__',
          'DevTools listening on ws://127.0.0.1:9222/devtools/browser/test',
          '__XVFB_LOG__',
          '',
          '__START_LOG__',
          '[neko] chromium start failed',
          '__MANIFEST__',
          '',
          '__TREE__',
          'debug browser files',
          '__PORTS__',
          'LISTEN 0 4096 127.0.0.1:9222',
        ].join('\n'),
        stderr: '',
        exitCode: 0,
      } as any;
    }
    throw new Error(`unexpected command: ${text.slice(0, 80)}`);
  });

  const result = await ensureNekoDebug('sandbox-chromium-late-ready', {
    requireTurn: false,
    strictIceCheck: false,
  });

  assert.equal(result.ready, true);
  assert.equal(result.status, 'running');
  assert.equal(startWrapperCallCount, 1);
  assert.equal(lateRecoveryCallCount, 1);
  assert.equal((metadataUpdates.at(-1) as any).debug.neko.status, 'running');
  assert.equal((metadataUpdates.at(-1) as any).debug.neko.reasonCode, undefined);
});

test('ensure neko debug recovers n.eko when lock timeout leaves CDP ready', async () => {
  const metadataUpdates: Array<Record<string, unknown>> = [];
  let lateRecoveryCallCount = 0;
  let cdpProbeCount = 0;
  let nekoProbeCount = 0;
  mock.method(sandboxExecutionEnvironmentDAO, 'getBySessionId', async () => ({
    sessionId: 'sandbox-lock-timeout-cdp-ready',
    status: 'ready',
    metadata: {},
  }) as any);
  mock.method(sandboxExecutionEnvironmentDAO, 'updateMetadata', async (_sessionId, metadata) => {
    metadataUpdates.push(metadata as Record<string, unknown>);
    return {} as any;
  });
  mock.method(e2bConnector, 'getSandboxHost', async (_sandboxId, port) => `${port}-sandbox-lock-timeout-cdp-ready.e2b.app`);
  mock.method(e2bConnector, 'runCommand', async (_sandboxId, command) => {
    const text = String(command);
    if (text.includes('recovering late-ready chromium')) {
      lateRecoveryCallCount += 1;
      return { stdout: '[neko] recovering late-ready chromium by starting n.eko\n', stderr: '', exitCode: 0 } as any;
    }
    if (text.startsWith('bash -lc ')) {
      const error = new Error('exit status 42') as any;
      error.exitCode = 42;
      error.stdout = '';
      error.stderr = '[neko] debug browser lock timeout\n';
      throw error;
    }
    if (text.includes('http://127.0.0.1:8081/')) {
      nekoProbeCount += 1;
      return { stdout: nekoProbeCount < 4 ? '000' : '200', stderr: '', exitCode: 0 } as any;
    }
    if (text.includes('http://127.0.0.1:9222/json/version')) {
      cdpProbeCount += 1;
      return { stdout: cdpProbeCount === 1 ? 'MISSING\n' : 'OK\n', stderr: '', exitCode: 0 } as any;
    }
    if (text.includes('command -v neko')) {
      return { stdout: 'OK\n', stderr: '', exitCode: 0 } as any;
    }
    if (text.includes('__CFG__')) {
      return {
        stdout: [
          '__CFG__',
          '',
          '__LOG__',
          'neko ready',
          '__CHROMIUM_LOG__',
          'DevTools listening on ws://127.0.0.1:9222/devtools/browser/test',
          '__XVFB_LOG__',
          '',
          '__START_LOG__',
          '[neko] debug browser lock timeout',
          '__MANIFEST__',
          '',
          '__TREE__',
          'debug browser files',
          '__PORTS__',
          'LISTEN 0 4096 127.0.0.1:9222',
        ].join('\n'),
        stderr: '',
        exitCode: 0,
      } as any;
    }
    throw new Error(`unexpected command: ${text.slice(0, 80)}`);
  });

  const result = await ensureNekoDebug('sandbox-lock-timeout-cdp-ready', {
    requireTurn: false,
    strictIceCheck: false,
  });

  assert.equal(result.ready, true);
  assert.equal(result.status, 'running');
  assert.equal(lateRecoveryCallCount, 1);
  assert.equal((metadataUpdates.at(-1) as any).debug.neko.status, 'running');
  assert.equal((metadataUpdates.at(-1) as any).debug.neko.reasonCode, undefined);
});

test('ensure neko debug returns visible diagnostics when the start script fails', async () => {
  const metadataUpdates: Array<Record<string, unknown>> = [];
  let capturedStartWrapper = '';
  mock.method(sandboxExecutionEnvironmentDAO, 'getBySessionId', async () => ({
    sessionId: 'sandbox-1',
    status: 'ready',
    metadata: {},
  }) as any);
  mock.method(sandboxExecutionEnvironmentDAO, 'updateMetadata', async (_sessionId, metadata) => {
    metadataUpdates.push(metadata as Record<string, unknown>);
    return {} as any;
  });
  mock.method(e2bConnector, 'getSandboxHost', async (_sandboxId, port) => `${port}-sandbox-1.e2b.app`);
  const runCommandMock = mock.method(e2bConnector, 'runCommand', async (_sandboxId, command) => {
    const text = String(command);
    if (text.startsWith('bash -lc ')) {
      capturedStartWrapper = text;
      const error = new Error('exit status 31') as any;
      error.exitCode = 31;
      error.stdout = '[neko] Xvfb missing\n';
      error.stderr = '';
      throw error;
    }
    if (text.includes('http://127.0.0.1:8081/')) {
      return { stdout: '000', stderr: '', exitCode: 0 } as any;
    }
    if (text.includes('http://127.0.0.1:9222/json/version')) {
      return { stdout: 'MISSING\n', stderr: '', exitCode: 0 } as any;
    }
    if (text.includes('command -v neko')) {
      return { stdout: 'OK\n', stderr: '', exitCode: 0 } as any;
    }
    if (text.includes('__CFG__')) {
      return {
        stdout: [
          '__CFG__',
          '',
          '__LOG__',
          '',
          '__CHROMIUM_LOG__',
          '',
          '__XVFB_LOG__',
          'missing xvfb',
          '__START_LOG__',
          'start log tail',
          '__MANIFEST__',
          '{"runtimeVersion":"debug-browser-runtime-v1"}',
          '__TREE__',
          'drwxr-xr-x user user 120 /tmp/oneceo/debug-browser',
          '__PORTS__',
          '',
        ].join('\n'),
        stderr: '',
        exitCode: 0,
      } as any;
    }
    throw new Error(`unexpected command: ${text.slice(0, 80)}`);
  });

  const result = await ensureNekoDebug('sandbox-1', {
    requireTurn: false,
    strictIceCheck: false,
  });

  assert.equal(result.ready, false);
  assert.equal(result.status, 'failed');
  assert.equal(result.reasonCode, 'xvfb_missing');
  assert.match(result.message || '', /Xvfb/);
  assert.ok(runCommandMock.mock.calls.some((call) => String(call.arguments[1]).startsWith('bash -lc ')));
  assert.match(capturedStartWrapper, /\/tmp\/oneceo\/debug-browser\/neko-static/);
  assert.match(capturedStartWrapper, /\/tmp\/oneceo\/debug-browser\/neko\.yml/);
  assert.match(capturedStartWrapper, /\/tmp\/oneceo\/debug-browser\/state\/manifest\.json/);
  assert.match(capturedStartWrapper, /"configVersion"/);
  assert.match(capturedStartWrapper, /--remote-debugging-address=127\.0\.0\.1/);
  assert.match(capturedStartWrapper, /ONECEO_NEKO_STATIC_ROOT:-\/opt\/neko\/client\/dist/);
  assert.doesNotMatch(capturedStartWrapper, /cat <<'EOF_EDGE_CSS' > "\$NEKO_STATIC_SOURCE/);
  assert.doesNotMatch(capturedStartWrapper, /pkill -x (chrome|chromium|neko|Xvfb)/);

  const lastUpdate = metadataUpdates.at(-1) as any;
  assert.equal(lastUpdate.debug.neko.status, 'failed');
  assert.equal(lastUpdate.debug.neko.reasonCode, 'xvfb_missing');
  assert.equal(lastUpdate.debug.neko.diagnostics.startScriptExitCode, 31);
  assert.match(lastUpdate.debug.neko.diagnostics.startScriptStdout, /Xvfb missing/);
  assert.match(lastUpdate.debug.neko.diagnostics.xvfbLogTail, /missing xvfb/);
  assert.match(lastUpdate.debug.neko.diagnostics.startLogTail, /start log tail/);
  assert.match(lastUpdate.debug.neko.diagnostics.manifest, /debug-browser-runtime-v1/);
  assert.match(lastUpdate.debug.neko.diagnostics.runtimeTree, /debug-browser/);
});
