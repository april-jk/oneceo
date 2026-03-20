import { e2bConnector } from '../connectors/e2b-connector';
import { codexAppServerService } from './codex-app-server-service';
import { ensurePlaywrightMcpInConfigToml } from '../utils/codex-runtime-config';

type CodexAppServerTurnInput = {
  sessionId: string;
  workspacePath: string;
  prompt: string;
  threadId?: string;
  waitTimeoutMs?: number;
  model?: string;
  codexBinaryPath?: string;
  configToml?: string;
  authJson?: string;
};

type CodexAppServerTurnResult = {
  threadId: string;
  turnId: string | null;
  notifications: Array<{ method: string; params: Record<string, unknown> }>;
  threadRead: Record<string, unknown>;
  stderr: string;
};

type CodexAppServerTurnJobStartInput = CodexAppServerTurnInput & {
  pollStartTimeoutMs?: number;
};

type CodexAppServerTurnJobStartResult = {
  jobId: string;
  threadId: string;
  turnId: string | null;
};

type CodexAppServerTurnJobPollResult = {
  status: 'starting' | 'running' | 'completed' | 'failed';
  threadId: string | null;
  turnId: string | null;
  notifications: Array<{ method: string; params: Record<string, unknown> }>;
  nextOffset: number;
  stderr: string;
  error?: string;
  threadRead?: Record<string, unknown>;
};

type CodexAppServerRuntimeConfig = {
  apiKey: string | null;
  providerName: string;
  baseUrl: string;
  model: string;
  reviewModel: string;
  reasoningEffort: string;
};

function shellSingleQuote(value: string): string {
  if (!value) return "''";
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function toPositiveInt(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value) || (value as number) <= 0) return fallback;
  return Math.floor(value as number);
}

function normalizeProviderBaseUrl(value: string | undefined): string {
  const trimmed = asString(value);
  if (!trimmed) return 'https://ai.hvmz.cn';
  const withoutTrailingSlash = trimmed.replace(/\/+$/, '');
  return withoutTrailingSlash.endsWith('/v1')
    ? withoutTrailingSlash.slice(0, -3)
    : withoutTrailingSlash;
}

function buildRuntimeConfig(): CodexAppServerRuntimeConfig {
  const apiKey = asString(process.env.CODEX_API_KEY) || asString(process.env.OPENAI_API_KEY) || null;
  const baseUrl = normalizeProviderBaseUrl(
    asString(process.env.CODEX_BASE_URL) ||
      asString(process.env.OPENAI_BASE_URL) ||
      asString(process.env.OPENAI_API_BASE) ||
      undefined
  );
  const model = asString(process.env.CODEX_MODEL) || asString(process.env.OPENAI_MODEL) || 'gpt-5.2';
  return {
    apiKey,
    providerName: 'OpenAI',
    baseUrl,
    model,
    reviewModel: model,
    reasoningEffort: 'high',
  };
}

function buildConfigToml(config: CodexAppServerRuntimeConfig): string {
  return ensurePlaywrightMcpInConfigToml([
    `model_provider = ${JSON.stringify(config.providerName)}`,
    `model = ${JSON.stringify(config.model)}`,
    `review_model = ${JSON.stringify(config.reviewModel)}`,
    `model_reasoning_effort = ${JSON.stringify(config.reasoningEffort)}`,
    'disable_response_storage = true',
    'network_access = "enabled"',
    'windows_wsl_setup_acknowledged = true',
    'model_context_window = 1000000',
    'model_auto_compact_token_limit = 900000',
    '',
    `[model_providers.${config.providerName}]`,
    `name = ${JSON.stringify(config.providerName)}`,
    `base_url = ${JSON.stringify(config.baseUrl)}`,
    'wire_api = "responses"',
    'supports_websockets = true',
    'requires_openai_auth = true',
    '',
    '[features]',
    'responses_websockets_v2 = true',
    '',
  ].join('\n'));
}

function buildAuthJson(config: CodexAppServerRuntimeConfig): string | null {
  if (!config.apiKey) return null;
  return JSON.stringify(
    {
      OPENAI_API_KEY: config.apiKey,
    },
    null,
    2
  );
}

function buildChildEnv(): Record<string, string> {
  const envs: Record<string, string> = {};
  const passthrough = [
    'OPENAI_API_KEY',
    'CODEX_API_KEY',
    'OPENAI_BASE_URL',
    'OPENAI_API_BASE',
    'CODEX_BASE_URL',
    'OPENAI_MODEL',
    'CODEX_MODEL',
  ];
  for (const key of passthrough) {
    const value = process.env[key];
    if (value && value.trim()) {
      envs[key] = value.trim();
    }
  }
  if (!envs.CODEX_API_KEY && envs.OPENAI_API_KEY) {
    envs.CODEX_API_KEY = envs.OPENAI_API_KEY;
  }
  if (!envs.OPENAI_API_KEY && envs.CODEX_API_KEY) {
    envs.OPENAI_API_KEY = envs.CODEX_API_KEY;
  }
  if (!envs.CODEX_BASE_URL) {
    const mirroredBase = envs.OPENAI_BASE_URL || envs.OPENAI_API_BASE || '';
    if (mirroredBase) envs.CODEX_BASE_URL = mirroredBase;
  }
  if (!envs.OPENAI_BASE_URL && envs.CODEX_BASE_URL) {
    envs.OPENAI_BASE_URL = envs.CODEX_BASE_URL;
  }
  if (!envs.CODEX_MODEL && envs.OPENAI_MODEL) {
    envs.CODEX_MODEL = envs.OPENAI_MODEL;
  }
  if (!envs.OPENAI_MODEL && envs.CODEX_MODEL) {
    envs.OPENAI_MODEL = envs.CODEX_MODEL;
  }
  return envs;
}

export class CodexAppServerTurnService {
  async startBackgroundTurn(input: CodexAppServerTurnJobStartInput): Promise<CodexAppServerTurnJobStartResult> {
    const waitTimeoutMs = toPositiveInt(input.waitTimeoutMs, 10 * 60_000);
    const pollStartTimeoutMs = toPositiveInt(input.pollStartTimeoutMs, 15_000);
    const runtimeConfig = buildRuntimeConfig();
    const configToml = ensurePlaywrightMcpInConfigToml(asString(input.configToml) || buildConfigToml(runtimeConfig));
    const authJson = asString(input.authJson) || buildAuthJson(runtimeConfig) || '';
    const jobId = `turn_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const server = await codexAppServerService.ensureServer({
      sessionId: input.sessionId,
      workspaceRoot: input.workspacePath,
      codexBinaryPath: input.codexBinaryPath || null,
      configToml,
      authJson,
    });
    const payload = {
      jobId,
      localEndpoint: server.localEndpoint,
      serverLogPath: server.logPath,
      workspacePath: input.workspacePath,
      prompt: input.prompt,
      threadId: input.threadId || null,
      model: input.model || null,
      waitTimeoutMs,
    };
    const payloadBase64 = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64');
    const command = `python3 - <<'PY'
import base64
import json
import os
import socket
import struct
import time
import urllib.parse
from pathlib import Path

payload = json.loads(base64.b64decode(${shellSingleQuote(payloadBase64)}).decode('utf-8'))
job_id = payload['jobId']
local_endpoint = payload['localEndpoint']
server_log_path = payload.get('serverLogPath') or '/tmp/codex-app-server.log'
workspace_path = payload['workspacePath']
prompt = payload['prompt']
thread_id = payload.get('threadId') or None
model = payload.get('model') or None
wait_timeout_ms = int(payload.get('waitTimeoutMs') or 600000)

job_dir = Path.home() / '.oneceo-codex-app-server' / 'jobs' / job_id
job_dir.mkdir(parents=True, exist_ok=True)
notifications_path = job_dir / 'notifications.jsonl'
status_path = job_dir / 'status.json'
start_path = job_dir / 'start.json'
result_path = job_dir / 'result.json'

def write_json(path: Path, payload):
    tmp = path.with_suffix(path.suffix + '.tmp')
    tmp.write_text(json.dumps(payload), encoding='utf-8')
    tmp.replace(path)

def append_notification(entry):
    with notifications_path.open('a', encoding='utf-8') as fh:
        fh.write(json.dumps(entry, ensure_ascii=False) + '\\n')
        fh.flush()

def read_server_log_tail(max_chars=4000):
    try:
        raw = Path(server_log_path).read_text(encoding='utf-8')
        return raw[-max_chars:] if len(raw) > max_chars else raw
    except Exception:
        return ''

def read_http_headers(sock):
    data = b''
    while b'\\r\\n\\r\\n' not in data:
        chunk = sock.recv(4096)
        if not chunk:
            break
        data += chunk
    return data.decode('utf-8', errors='replace')

def read_exact(sock, size):
    chunks = []
    remaining = size
    while remaining > 0:
        chunk = sock.recv(remaining)
        if not chunk:
            raise RuntimeError('websocket closed unexpectedly')
        chunks.append(chunk)
        remaining -= len(chunk)
    return b''.join(chunks)

def open_websocket(url: str):
    parsed = urllib.parse.urlparse(url)
    host = parsed.hostname or '127.0.0.1'
    port = parsed.port or 80
    path = parsed.path or '/'
    if parsed.query:
        path = path + '?' + parsed.query
    sock = socket.create_connection((host, port), timeout=10)
    key = base64.b64encode(os.urandom(16)).decode('ascii')
    request = (
        f'GET {path} HTTP/1.1\\r\\n'
        f'Host: {host}:{port}\\r\\n'
        'Upgrade: websocket\\r\\n'
        'Connection: Upgrade\\r\\n'
        f'Sec-WebSocket-Key: {key}\\r\\n'
        'Sec-WebSocket-Version: 13\\r\\n'
        '\\r\\n'
    )
    sock.sendall(request.encode('utf-8'))
    response = read_http_headers(sock)
    first_line = response.splitlines()[0] if response else ''
    if '101' not in first_line:
        raise RuntimeError(f'websocket handshake failed: {first_line or response}')
    sock.settimeout(1.0)
    return sock

def send_frame(sock, payload_bytes: bytes, opcode=0x1):
    mask = os.urandom(4)
    length = len(payload_bytes)
    header = bytearray([0x80 | opcode])
    if length < 126:
        header.append(0x80 | length)
    elif length < 65536:
        header.append(0x80 | 126)
        header.extend(struct.pack('!H', length))
    else:
        header.append(0x80 | 127)
        header.extend(struct.pack('!Q', length))
    header.extend(mask)
    masked = bytes(payload_bytes[i] ^ mask[i % 4] for i in range(length))
    sock.sendall(bytes(header) + masked)

def send_json(sock, payload):
    send_frame(sock, json.dumps(payload).encode('utf-8'), opcode=0x1)

def recv_frame(sock):
    first_two = read_exact(sock, 2)
    first = first_two[0]
    second = first_two[1]
    fin = (first & 0x80) != 0
    opcode = first & 0x0F
    masked = (second & 0x80) != 0
    length = second & 0x7F
    if length == 126:
        length = struct.unpack('!H', read_exact(sock, 2))[0]
    elif length == 127:
        length = struct.unpack('!Q', read_exact(sock, 8))[0]
    mask = read_exact(sock, 4) if masked else None
    payload = read_exact(sock, length) if length else b''
    if masked and mask is not None:
        payload = bytes(payload[i] ^ mask[i % 4] for i in range(length))
    return fin, opcode, payload

def recv_json(sock):
    opcode = None
    chunks = []
    while True:
      fin, frame_opcode, payload = recv_frame(sock)
      if frame_opcode == 0x8:
          raise RuntimeError('websocket closed by server')
      if frame_opcode == 0x9:
          send_frame(sock, payload, opcode=0xA)
          continue
      if frame_opcode == 0xA:
          continue
      if frame_opcode == 0x0:
          chunks.append(payload)
      elif frame_opcode == 0x1:
          opcode = frame_opcode
          chunks.append(payload)
      else:
          continue
      if fin:
          raw = b''.join(chunks).decode('utf-8', errors='replace')
          return json.loads(raw)

def main():
    os.makedirs(workspace_path, exist_ok=True)
    write_json(status_path, {'status': 'starting', 'jobId': job_id})
    notifications = []
    request_seq = 0
    resolved_thread_id = ''
    turn_id = ''
    sock = None

    def request(method, params=None, timeout_ms=30000):
        nonlocal request_seq
        request_seq += 1
        request_id = f'{job_id}_{request_seq}'
        send_json(sock, {
            'jsonrpc': '2.0',
            'id': request_id,
            'method': method,
            **({} if params is None else {'params': params}),
        })
        deadline = time.time() + (timeout_ms / 1000.0)
        while time.time() < deadline:
            try:
                payload = recv_json(sock)
            except socket.timeout:
                continue
            if 'id' in payload:
                if str(payload.get('id')) != request_id:
                    continue
                if payload.get('error'):
                    error_payload = payload.get('error') or {}
                    raise RuntimeError(error_payload.get('message') or json.dumps(error_payload))
                return payload.get('result')
            method_name = (payload.get('method') or '').strip()
            if method_name:
                entry = {
                    'method': method_name,
                    'params': payload.get('params') or {},
                }
                notifications.append(entry)
                append_notification(entry)
        raise TimeoutError(f'request timed out: {method}')

    def wait_for_turn_completion(turn_to_wait: str):
        deadline = time.time() + (wait_timeout_ms / 1000.0)
        while time.time() < deadline:
            try:
                payload = recv_json(sock)
            except socket.timeout:
                continue
            if 'id' in payload:
                continue
            method_name = (payload.get('method') or '').strip()
            if not method_name:
                continue
            entry = {
                'method': method_name,
                'params': payload.get('params') or {},
            }
            notifications.append(entry)
            append_notification(entry)
            if method_name == 'turn/completed':
                turn = (entry['params'] or {}).get('turn') or {}
                if str(turn.get('id') or '').strip() == turn_to_wait:
                    return
        raise TimeoutError(f'turn {turn_to_wait} did not complete before timeout')

    try:
        sock = open_websocket(local_endpoint)
        request('initialize', {
            'clientInfo': {
                'name': 'oneceo-codex-app-server-turn-job',
                'title': 'oneceo codex app-server turn job',
                'version': '0.0.1',
            },
            'capabilities': {
                'experimentalApi': True,
                'optOutNotificationMethods': [],
            },
        }, timeout_ms=15000)
        thread_result = request(
            'thread/resume' if thread_id else 'thread/start',
            ({'threadId': thread_id, 'cwd': workspace_path} if thread_id else {
                'cwd': workspace_path,
                'approvalPolicy': 'never',
                'sandbox': 'workspace-write',
                'experimentalRawEvents': False,
                'persistExtendedHistory': True,
                **({'model': model} if model else {}),
            }),
            timeout_ms=30000,
        )
        resolved_thread_id = str(((thread_result or {}).get('thread') or {}).get('id') or thread_id or '').strip()
        if not resolved_thread_id:
            raise RuntimeError('thread id missing')
        turn_result = request('turn/start', {
            'threadId': resolved_thread_id,
            'cwd': workspace_path,
            'approvalPolicy': 'never',
            'sandboxPolicy': {
                'type': 'workspaceWrite',
                'writableRoots': [workspace_path],
                'networkAccess': True,
                'excludeTmpDirEnvVar': False,
                'excludeSlashTmp': False,
            },
            'input': [
                {
                    'type': 'text',
                    'text': prompt,
                }
            ],
        }, timeout_ms=30000)
        turn_id = str(((turn_result or {}).get('turn') or {}).get('id') or '').strip()
        write_json(start_path, {
            'jobId': job_id,
            'threadId': resolved_thread_id,
            'turnId': turn_id or None,
        })
        write_json(status_path, {
            'status': 'running',
            'jobId': job_id,
            'threadId': resolved_thread_id,
            'turnId': turn_id or None,
        })
        if turn_id:
            wait_for_turn_completion(turn_id)
        thread_read = request('thread/read', {
            'threadId': resolved_thread_id,
            'includeTurns': True,
        }, timeout_ms=30000)
        write_json(result_path, {
            'jobId': job_id,
            'threadId': resolved_thread_id,
            'turnId': turn_id or None,
            'threadRead': thread_read,
            'stderr': read_server_log_tail(),
        })
        write_json(status_path, {
            'status': 'completed',
            'jobId': job_id,
            'threadId': resolved_thread_id,
            'turnId': turn_id or None,
        })
    except Exception as error:
        write_json(result_path, {
            'jobId': job_id,
            'threadId': resolved_thread_id or None,
            'turnId': turn_id or None,
            'error': str(error),
            'stderr': read_server_log_tail(),
        })
        write_json(status_path, {
            'status': 'failed',
            'jobId': job_id,
            'threadId': resolved_thread_id or None,
            'turnId': turn_id or None,
            'error': str(error),
        })
    finally:
        try:
            if sock is not None:
                send_frame(sock, b'', opcode=0x8)
                sock.close()
        except Exception:
            pass

main()
PY`;

    await e2bConnector.runCommand(input.sessionId, command, {
      background: true,
      timeoutMs: 15_000,
    });

    const started = await this.pollTurnJobUntilStarted(input.sessionId, jobId, pollStartTimeoutMs);
    if (!started.threadId) {
      throw new Error('Codex App Server turn job 未返回 threadId');
    }
    return {
      jobId,
      threadId: started.threadId,
      turnId: started.turnId,
    };
  }

  private async pollTurnJobUntilStarted(
    sessionId: string,
    jobId: string,
    timeoutMs: number
  ): Promise<{ threadId: string; turnId: string | null }> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const poll = await this.readTurnJob(sessionId, jobId, 0);
      if (poll.threadId) {
        return {
          threadId: poll.threadId,
          turnId: poll.turnId,
        };
      }
      if (poll.status === 'failed') {
        throw new Error(poll.error || 'Codex App Server turn job 启动失败');
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error('Codex App Server turn job 启动超时');
  }

  async readTurnJob(
    sessionId: string,
    jobId: string,
    notificationOffset = 0
  ): Promise<CodexAppServerTurnJobPollResult> {
    const payloadBase64 = Buffer.from(
      JSON.stringify({
        jobId,
        notificationOffset,
      }),
      'utf-8'
    ).toString('base64');
    const command = `python3 - <<'PY'
import base64
import json
from pathlib import Path

payload = json.loads(base64.b64decode(${shellSingleQuote(payloadBase64)}).decode('utf-8'))
job_id = payload['jobId']
offset = int(payload.get('notificationOffset') or 0)
job_dir = Path.home() / '.oneceo-codex-app-server' / 'jobs' / job_id
notifications_path = job_dir / 'notifications.jsonl'
status_path = job_dir / 'status.json'
result_path = job_dir / 'result.json'
stderr_path = job_dir / 'stderr.log'
start_path = job_dir / 'start.json'

status_payload = {}
if status_path.exists():
    try:
        status_payload = json.loads(status_path.read_text(encoding='utf-8'))
    except Exception:
        status_payload = {}

result_payload = {}
if result_path.exists():
    try:
        result_payload = json.loads(result_path.read_text(encoding='utf-8'))
    except Exception:
        result_payload = {}

start_payload = {}
if start_path.exists():
    try:
        start_payload = json.loads(start_path.read_text(encoding='utf-8'))
    except Exception:
        start_payload = {}

lines = []
if notifications_path.exists():
    lines = notifications_path.read_text(encoding='utf-8').splitlines()

notifications = []
for line in lines[offset:]:
    line = line.strip()
    if not line:
        continue
    try:
        notifications.append(json.loads(line))
    except Exception:
        continue

stderr = ''
if stderr_path.exists():
    try:
        stderr = stderr_path.read_text(encoding='utf-8')[-4000:]
    except Exception:
        stderr = ''

print(json.dumps({
    'status': str(status_payload.get('status') or 'starting'),
    'threadId': status_payload.get('threadId') or start_payload.get('threadId') or result_payload.get('threadId'),
    'turnId': status_payload.get('turnId') or start_payload.get('turnId') or result_payload.get('turnId'),
    'notifications': notifications,
    'nextOffset': len(lines),
    'stderr': stderr or str(result_payload.get('stderr') or ''),
    'error': result_payload.get('error') or status_payload.get('error'),
    'threadRead': result_payload.get('threadRead'),
}))
PY`;
    const result: any = await e2bConnector.runCommand(sessionId, command, {
      timeoutMs: 20_000,
    });
    const stdout = asString(result?.stdout || result?.output);
    if (!stdout) {
      return {
        status: 'starting',
        threadId: null,
        turnId: null,
        notifications: [],
        nextOffset: notificationOffset,
        stderr: '',
      };
    }
    const parsed = JSON.parse(stdout) as Record<string, unknown>;
    return {
      status: (asString(parsed.status) as CodexAppServerTurnJobPollResult['status']) || 'starting',
      threadId: asString(parsed.threadId) || null,
      turnId: asString(parsed.turnId) || null,
      notifications: Array.isArray(parsed.notifications)
        ? parsed.notifications.map((entry) => ({
            method: asString((entry as any)?.method),
            params: ((entry as any)?.params || {}) as Record<string, unknown>,
          }))
        : [],
      nextOffset:
        typeof parsed.nextOffset === 'number' && Number.isFinite(parsed.nextOffset)
          ? Math.floor(parsed.nextOffset)
          : notificationOffset,
      stderr: asString(parsed.stderr),
      error: asString(parsed.error) || undefined,
      threadRead:
        parsed.threadRead && typeof parsed.threadRead === 'object'
          ? (parsed.threadRead as Record<string, unknown>)
          : undefined,
    };
  }

  async runTurn(input: CodexAppServerTurnInput): Promise<CodexAppServerTurnResult> {
    const waitTimeoutMs = toPositiveInt(input.waitTimeoutMs, 45_000);
    const runtimeConfig = buildRuntimeConfig();
    const configToml = asString(input.configToml) || buildConfigToml(runtimeConfig);
    const authJson = asString(input.authJson) || buildAuthJson(runtimeConfig) || '';
    const payload = {
      workspacePath: input.workspacePath,
      prompt: input.prompt,
      threadId: input.threadId || null,
      model: input.model || null,
      codexBinaryPath: input.codexBinaryPath || null,
      waitTimeoutMs,
      configToml,
      authJson,
    };
    const payloadBase64 = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64');

    const command = `python3 - <<'PY'
import asyncio
import base64
import json
import os
import subprocess
import sys

payload = json.loads(base64.b64decode(${shellSingleQuote(payloadBase64)}).decode('utf-8'))
workspace_path = payload['workspacePath']
prompt = payload['prompt']
thread_id = payload.get('threadId') or None
model = payload.get('model') or None
codex_binary_path = payload.get('codexBinaryPath') or 'codex'
wait_timeout_ms = int(payload.get('waitTimeoutMs') or 45000)
config_toml = payload.get('configToml') or ''
auth_json = payload.get('authJson') or ''

os.makedirs(workspace_path, exist_ok=True)
codex_home = os.path.expanduser('~/.codex')
os.makedirs(codex_home, exist_ok=True)
if config_toml:
    with open(os.path.join(codex_home, 'config.toml'), 'w', encoding='utf-8') as fh:
        fh.write(config_toml)
if auth_json:
    with open(os.path.join(codex_home, 'auth.json'), 'w', encoding='utf-8') as fh:
        fh.write(auth_json)

child_env = os.environ.copy()
for deprecated_key in ['OPENAI_BASE_URL', 'OPENAI_API_BASE', 'CODEX_BASE_URL']:
    child_env.pop(deprecated_key, None)

child = subprocess.Popen(
    [codex_binary_path, 'app-server'],
    stdin=subprocess.PIPE,
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
    text=True,
    bufsize=1,
    env=child_env,
)

pending = {}
notifications = []
stderr_chunks = []

async def read_stderr():
    while True:
        line = await asyncio.to_thread(child.stderr.readline)
        if not line:
            break
        stderr_chunks.append(line)

async def read_stdout():
    while True:
        line = await asyncio.to_thread(child.stdout.readline)
        if not line:
            break
        line = line.strip()
        if not line:
            continue
        payload = json.loads(line)
        if 'id' in payload:
            future = pending.pop(payload['id'], None)
            if future is None:
                continue
            if payload.get('error'):
                future.set_exception(RuntimeError(payload['error'].get('message') or json.dumps(payload['error'])))
            else:
                future.set_result(payload.get('result'))
            continue
        method = payload.get('method')
        if method:
            notifications.append({
                'method': method,
                'params': payload.get('params') or {},
            })

async def request(req_id, method, params=None):
    future = asyncio.get_running_loop().create_future()
    pending[req_id] = future
    payload = {
        'jsonrpc': '2.0',
        'id': req_id,
        'method': method,
    }
    if params is not None:
        payload['params'] = params
    child.stdin.write(json.dumps(payload) + '\\n')
    child.stdin.flush()
    return await future

async def wait_for_turn_completion(turn_id, timeout_ms):
    deadline = asyncio.get_running_loop().time() + (timeout_ms / 1000.0)
    while asyncio.get_running_loop().time() < deadline:
        for entry in notifications:
            if entry.get('method') != 'turn/completed':
                continue
            params = entry.get('params') or {}
            turn = params.get('turn') or {}
            if str(turn.get('id') or '') == str(turn_id):
                return
        await asyncio.sleep(0.25)
    raise TimeoutError(f'turn {turn_id} did not complete before timeout')

async def main():
    stderr_task = asyncio.create_task(read_stderr())
    stdout_task = asyncio.create_task(read_stdout())
    try:
        await request('init', 'initialize', {
            'clientInfo': {
                'name': 'oneceo-codex-app-server-turn',
                'title': 'oneceo codex app-server turn',
                'version': '0.0.1',
            },
            'capabilities': {
                'experimentalApi': True,
                'optOutNotificationMethods': [],
            },
        })
        thread_result = await request(
            'thread',
            'thread/resume' if thread_id else 'thread/start',
            ({'threadId': thread_id, 'cwd': workspace_path} if thread_id else {
                'cwd': workspace_path,
                'approvalPolicy': 'never',
                'sandbox': 'workspace-write',
                'experimentalRawEvents': False,
                'persistExtendedHistory': True,
                **({'model': model} if model else {}),
            })
        )
        resolved_thread_id = str(((thread_result or {}).get('thread') or {}).get('id') or thread_id or '').strip()
        if not resolved_thread_id:
            raise RuntimeError('thread id missing')
        turn_result = await request('turn', 'turn/start', {
            'threadId': resolved_thread_id,
            'cwd': workspace_path,
            'approvalPolicy': 'never',
            'sandboxPolicy': {
                'type': 'workspaceWrite',
                'writableRoots': [workspace_path],
                'networkAccess': True,
                'excludeTmpDirEnvVar': False,
                'excludeSlashTmp': False,
            },
            'input': [
                {
                    'type': 'text',
                    'text': prompt,
                }
            ],
        })
        turn_id = str(((turn_result or {}).get('turn') or {}).get('id') or '').strip()
        if turn_id:
            await wait_for_turn_completion(turn_id, wait_timeout_ms)
        thread_read = await request('thread-read', 'thread/read', {
            'threadId': resolved_thread_id,
            'includeTurns': True,
        })
        print(json.dumps({
            'threadId': resolved_thread_id,
            'turnId': turn_id or None,
            'notifications': notifications,
            'threadRead': thread_read,
            'stderr': ''.join(stderr_chunks),
        }))
    finally:
        child.terminate()
        try:
            await asyncio.wait_for(asyncio.to_thread(child.wait), timeout=5)
        except Exception:
            child.kill()
        await asyncio.gather(stderr_task, stdout_task, return_exceptions=True)

asyncio.run(main())
PY`;

    const result: any = await e2bConnector.runCommand(input.sessionId, command, {
      timeoutMs: waitTimeoutMs + 30_000,
      envs: buildChildEnv(),
    });
    const stdout = asString(result?.stdout || result?.output);
    if (!stdout) {
      throw new Error('Codex App Server turn returned empty stdout');
    }
    const parsed = JSON.parse(stdout) as Record<string, unknown>;
    return {
      threadId: asString(parsed.threadId),
      turnId: asString(parsed.turnId) || null,
      notifications: Array.isArray(parsed.notifications)
        ? parsed.notifications.map((entry) => ({
            method: asString((entry as any)?.method),
            params: ((entry as any)?.params || {}) as Record<string, unknown>,
          }))
        : [],
      threadRead: ((parsed.threadRead || {}) as Record<string, unknown>) || {},
      stderr: asString(parsed.stderr),
    };
  }
}

export const codexAppServerTurnService = new CodexAppServerTurnService();
