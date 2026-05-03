import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  __buildNekoClientUrlForTest,
  __hasTurnIceServerForTest,
  __parseIceServersForTest,
  __renderNekoMemberYamlForTest,
  detectIceFailureFromLog,
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
