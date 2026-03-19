import dotenv from 'dotenv';
import path from 'node:path';
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });

type JsonRpcRequest = {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
};

type JsonRpcResponse = {
  jsonrpc?: string;
  id?: string | number;
  result?: any;
  error?: any;
};

type JsonRpcNotification = {
  jsonrpc?: string;
  method?: string;
  params?: any;
};

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function createRequest(id: string | number, method: string, params?: Record<string, unknown>): JsonRpcRequest {
  return {
    jsonrpc: '2.0',
    id,
    method,
    ...(params ? { params } : {}),
  };
}

async function main() {
  const port = Number(process.argv[2] || 4321);
  const listenUrl = `ws://0.0.0.0:${port}`;
  const waitMs = Math.max(10_000, Number(process.argv[3] || 30_000));

  const { e2bConnector } = await import('../../src/connectors/e2b-connector');
  const { e2bConfig } = await import('../../src/config/e2b-config');
  const { resolveOpencodeWorkspacePath } = await import('../../src/utils/opencode-workspace');

  const taskSessionId = `codex_appserver_probe_${Date.now()}`;
  const workspacePath = resolveOpencodeWorkspacePath(taskSessionId);
  const envs: Record<string, string> = {};
  const passthroughKeys = [
    'OPENAI_API_KEY',
    'CODEX_API_KEY',
    'OPENAI_BASE_URL',
    'OPENAI_API_BASE',
    'OPENAI_MODEL',
    'CODEX_BASE_URL',
    'CODEX_MODEL',
  ];
  for (const key of passthroughKeys) {
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
    if (mirroredBase) {
      envs.CODEX_BASE_URL = mirroredBase;
    }
  }
  if (!envs.OPENAI_BASE_URL && envs.CODEX_BASE_URL) {
    envs.OPENAI_BASE_URL = envs.CODEX_BASE_URL;
  }
  if (!envs.CODEX_MODEL) {
    const mirroredModel = envs.OPENAI_MODEL || '';
    if (mirroredModel) {
      envs.CODEX_MODEL = mirroredModel;
    }
  }
  if (!envs.OPENAI_MODEL && envs.CODEX_MODEL) {
    envs.OPENAI_MODEL = envs.CODEX_MODEL;
  }

  const sandbox = await e2bConnector.createSandbox({
    template: e2bConfig.codexTemplate,
    metadata: {
      owner: 'codex-app-server-probe',
      purpose: 'codex-app-server-probe',
      taskSessionId,
      taskTitle: 'codex app-server probe',
      executor: 'codex',
    },
    envs,
  });
  const sessionId = sandbox.sandboxId;
  await e2bConnector.runCommand(
    sessionId,
    `mkdir -p ${JSON.stringify(workspacePath)} && cd ${JSON.stringify(workspacePath)} && pwd`,
    { timeoutMs: 15_000 }
  );
  const startCommand = `nohup codex app-server --listen ${listenUrl} >/tmp/codex-app-server.log 2>&1 < /dev/null &`;
  await e2bConnector.runCommand(sessionId, startCommand, { timeoutMs: 15_000 });
  await sleep(4_000);

  const portProbe = await e2bConnector.runCommand(
    sessionId,
    `bash -lc 'for i in $(seq 1 20); do if command -v ss >/dev/null 2>&1 && ss -lnt | grep -q ":${port} "; then echo READY; exit 0; fi; sleep 1; done; echo NOT_READY; exit 1'`,
    { timeoutMs: 25_000 }
  );
  if (!String((portProbe as any)?.stdout || '').includes('READY')) {
    const appServerLog = await e2bConnector.runCommand(sessionId, 'cat /tmp/codex-app-server.log || true', {
      timeoutMs: 15_000,
    });
    throw new Error(
      `codex app-server port not ready\nsessionId=${sessionId}\nstdout=${String((portProbe as any)?.stdout || '')}\nstderr=${String((portProbe as any)?.stderr || '')}\nlog=${String((appServerLog as any)?.stdout || '')}`
    );
  }

  const pythonModelLiteral =
    process.env.CODEX_MODEL || process.env.OPENAI_MODEL
      ? JSON.stringify(process.env.CODEX_MODEL || process.env.OPENAI_MODEL)
      : 'None';

  const probeScript = String.raw`
import asyncio
import json

import websockets

WAIT_MS = ${waitMs}
WORKSPACE_PATH = ${JSON.stringify(workspacePath)}
MODEL = ${pythonModelLiteral}

class Client:
    def __init__(self, ws):
        self.ws = ws
        self.pending = {}
        self.notifications = []
        self.reader_task = None

    async def start(self):
        self.reader_task = asyncio.create_task(self.reader())

    async def reader(self):
        async for raw in self.ws:
            payload = json.loads(raw)
            if "id" in payload:
                future = self.pending.pop(payload["id"], None)
                if future is None:
                    continue
                if payload.get("error"):
                    future.set_exception(RuntimeError(payload["error"].get("message") or json.dumps(payload["error"])))
                else:
                    future.set_result(payload.get("result"))
                continue
            method = payload.get("method")
            if method:
                self.notifications.append({
                    "method": method,
                    "params": payload.get("params"),
                })

    async def request(self, req_id, method, params=None):
        loop = asyncio.get_running_loop()
        future = loop.create_future()
        self.pending[req_id] = future
        payload = {
            "jsonrpc": "2.0",
            "id": req_id,
            "method": method,
        }
        if params is not None:
            payload["params"] = params
        await self.ws.send(json.dumps(payload))
        return await future

async def main():
    async with websockets.connect("ws://127.0.0.1:${port}") as ws:
        client = Client(ws)
        await client.start()

        initialize_result = await client.request("init", "initialize", {
            "clientInfo": {
                "name": "oneceo-app-server-probe",
                "title": "oneceo app-server probe",
                "version": "0.0.1",
            },
            "capabilities": {
                "experimentalApi": True,
                "optOutNotificationMethods": [],
            },
        })

        thread_start_result = await client.request("thread-start", "thread/start", {
            "cwd": WORKSPACE_PATH,
            "approvalPolicy": "never",
            "sandbox": "danger-full-access",
            "model": MODEL,
            "experimentalRawEvents": False,
            "persistExtendedHistory": True,
        })

        thread_id = str(((thread_start_result or {}).get("thread") or {}).get("id") or "").strip()
        if not thread_id:
            raise RuntimeError("thread/start did not return thread.id")

        turn_start_result = await client.request("turn-start", "turn/start", {
            "threadId": thread_id,
            "cwd": WORKSPACE_PATH,
            "sandboxPolicy": {
                "type": "dangerFullAccess",
            },
            "approvalPolicy": "never",
            "input": [
                {
                    "type": "text",
                    "text": "Create a file named hello.txt with exact content hello from app server probe, then report completion briefly."
                }
            ],
        })

        turn_id = str(((turn_start_result or {}).get("turn") or {}).get("id") or "").strip()

        await asyncio.sleep(WAIT_MS / 1000)

        thread_read_result = await client.request("thread-read", "thread/read", {
            "threadId": thread_id,
            "includeTurns": True,
        })

        relevant_notifications = [
            entry for entry in client.notifications
            if entry["method"] in {
                "turn/started",
                "turn/completed",
                "turn/diff/updated",
                "item/started",
                "item/completed",
                "item/fileChange/outputDelta",
                "item/agentMessage/delta",
            }
        ]

        print(json.dumps({
            "initializeResult": initialize_result,
            "threadId": thread_id,
            "turnId": turn_id,
            "relevantNotifications": relevant_notifications,
            "threadReadResult": thread_read_result,
        }, indent=2))

asyncio.run(main())
`;

  const uploadCommand = `cat <<'EOF' >/tmp/codex-app-server-probe.py\n${probeScript}\nEOF`;
  await e2bConnector.runCommand(sessionId, uploadCommand, { timeoutMs: 15_000 });
  await e2bConnector.runCommand(
    sessionId,
    `python3 - <<'PY'\nimport importlib.util, subprocess, sys\nif importlib.util.find_spec("websockets") is None:\n    subprocess.check_call([sys.executable, "-m", "pip", "install", "--user", "websockets"])\nprint("websockets-ready")\nPY`,
    { timeoutMs: 120_000 }
  );
  let probeResult: any;
  try {
    probeResult = await e2bConnector.runCommand(sessionId, 'python3 /tmp/codex-app-server-probe.py', {
      timeoutMs: waitMs + 30_000,
    });
  } catch (error) {
    const appServerLog = await e2bConnector.runCommand(sessionId, 'cat /tmp/codex-app-server.log || true', {
      timeoutMs: 15_000,
    });
    const probeLog = await e2bConnector.runCommand(
      sessionId,
      "bash -lc 'python3 /tmp/codex-app-server-probe.py >/tmp/codex-app-server-probe.out 2>/tmp/codex-app-server-probe.err; true; echo STDOUT; cat /tmp/codex-app-server-probe.out; echo STDERR; cat /tmp/codex-app-server-probe.err'",
      {
        timeoutMs: waitMs + 30_000,
      }
    );
    throw new Error(
      `sandbox-local app-server probe failed\nsessionId=${sessionId}\nerror=${error instanceof Error ? error.message : String(error)}\nappServerLog=${String((appServerLog as any)?.stdout || '')}\nprobeOutput=${String((probeLog as any)?.stdout || '')}`
    );
  }

  let parsed: any = null;
  const stdout = String((probeResult as any)?.stdout || '').trim();
  if (stdout) {
    parsed = JSON.parse(stdout);
  }

  console.log(
    JSON.stringify(
      {
        phase: 'completed',
        sessionId,
        workspacePath,
        probeStdout: stdout,
        threadId: parsed?.threadId || null,
        turnId: parsed?.turnId || null,
        relevantNotifications: Array.isArray(parsed?.relevantNotifications) ? parsed.relevantNotifications : [],
        threadReadSummary: {
          turnCount: Array.isArray(parsed?.threadReadResult?.thread?.turns) ? parsed.threadReadResult.thread.turns.length : 0,
          latestTurnId:
            Array.isArray(parsed?.threadReadResult?.thread?.turns) && parsed.threadReadResult.thread.turns.length > 0
              ? parsed.threadReadResult.thread.turns[parsed.threadReadResult.thread.turns.length - 1]?.id
              : null,
        },
      },
      null,
      2
    )
  );
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
