import { execFileSync } from 'node:child_process';
import path from 'node:path';

type Listener = {
  pid: number;
  command: string;
  cwd: string;
};

const apiRoot = path.resolve(process.cwd());
const port = normalizePort(process.env.PORT || '4000');

function normalizePort(raw: string) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 4000;
  }
  return Math.floor(parsed);
}

function runCommand(command: string, args: string[], options?: { allowNoOutput?: boolean }) {
  try {
    return execFileSync(command, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      throw new Error(`${command}_not_found`);
    }
    if (options?.allowNoOutput && typeof error?.status === 'number' && error.status === 1) {
      return '';
    }
    throw error;
  }
}

function listListeningPids(targetPort: number) {
  const output = runCommand(
    'lsof',
    ['-nP', `-iTCP:${targetPort}`, '-sTCP:LISTEN', '-t'],
    { allowNoOutput: true }
  );
  return output
    .split('\n')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => Number(entry))
    .filter((value) => Number.isFinite(value) && value > 0);
}

function readProcessCommand(pid: number) {
  return runCommand('ps', ['-p', String(pid), '-o', 'command='], { allowNoOutput: true });
}

function readProcessCwd(pid: number) {
  const output = runCommand('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], {
    allowNoOutput: true,
  });
  const line = output
    .split('\n')
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith('n'));
  return line ? path.resolve(line.slice(1)) : '';
}

function readParentPid(pid: number) {
  const output = runCommand('ps', ['-p', String(pid), '-o', 'ppid='], { allowNoOutput: true });
  const parsed = Number(output.trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function collectAncestorPids(startPid: number) {
  const visited = new Set<number>();
  let current = startPid;
  while (current > 0 && !visited.has(current)) {
    visited.add(current);
    current = readParentPid(current);
  }
  return visited;
}

function describeListeners(targetPort: number): Listener[] {
  return listListeningPids(targetPort).map((pid) => ({
    pid,
    command: readProcessCommand(pid),
    cwd: readProcessCwd(pid),
  }));
}

function isSameApiProcess(listener: Listener) {
  if (listener.cwd !== apiRoot) {
    return false;
  }
  const command = listener.command;
  if (!command) {
    return false;
  }
  return (
    command.includes('src/index.ts') ||
    command.includes('dist/index.js') ||
    command.includes('tsx watch src/index.ts') ||
    command.includes('scripts/dev-preflight.ts')
  );
}

function listPotentialApiDevPids() {
  const output = runCommand(
    'pgrep',
    ['-af', 'tsx watch src/index.ts|src/index.ts|scripts/dev-preflight.ts'],
    { allowNoOutput: true }
  );
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const firstSpace = line.indexOf(' ');
      const pid = Number(firstSpace > 0 ? line.slice(0, firstSpace) : line);
      const command = firstSpace > 0 ? line.slice(firstSpace + 1).trim() : '';
      return { pid, command };
    })
    .filter((entry) => Number.isFinite(entry.pid) && entry.pid > 0);
}

function describePotentialApiDevProcesses(excludedPids: Set<number>) {
  return listPotentialApiDevPids()
    .filter((entry) => !excludedPids.has(entry.pid))
    .map((entry) => ({
      pid: entry.pid,
      command: entry.command || readProcessCommand(entry.pid),
      cwd: readProcessCwd(entry.pid),
    }))
    .filter((entry) => entry.cwd === apiRoot)
    .filter(
      (entry) =>
        entry.command.includes('src/index.ts') ||
        entry.command.includes('tsx watch src/index.ts') ||
        entry.command.includes('scripts/dev-preflight.ts')
    );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForPortRelease(targetPort: number, timeoutMs: number) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (describeListeners(targetPort).length === 0) {
      return true;
    }
    await sleep(250);
  }
  return describeListeners(targetPort).length === 0;
}

async function waitForProcessExit(
  targetPids: number[],
  timeoutMs: number,
  excludedPids: Set<number>
) {
  const pending = new Set(targetPids.filter((pid) => pid > 0 && !excludedPids.has(pid)));
  if (pending.size === 0) {
    return true;
  }
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const active = new Set(
      describePotentialApiDevProcesses(excludedPids)
        .map((entry) => entry.pid)
        .filter((pid) => pending.has(pid))
    );
    if (active.size === 0) {
      return true;
    }
    await sleep(250);
  }
  const active = new Set(
    describePotentialApiDevProcesses(excludedPids)
      .map((entry) => entry.pid)
      .filter((pid) => pending.has(pid))
  );
  return active.size === 0;
}

async function reclaimPort(targetPort: number) {
  const excludedPids = collectAncestorPids(process.pid);
  const listeners = describeListeners(targetPort);
  const candidates = new Map<number, Listener>();

  for (const listener of listeners) {
    if (!excludedPids.has(listener.pid)) {
      candidates.set(listener.pid, listener);
    }
  }

  for (const processInfo of describePotentialApiDevProcesses(excludedPids)) {
    candidates.set(processInfo.pid, processInfo);
  }

  if (candidates.size === 0) {
    return;
  }

  const processes = Array.from(candidates.values());

  const foreignListeners = processes.filter((listener) => !isSameApiProcess(listener));
  if (foreignListeners.length > 0) {
    console.error(`[API] Port ${targetPort} is already in use by another process.`);
    for (const listener of foreignListeners) {
      console.error(
        `[API] PID ${listener.pid} cwd=${listener.cwd || 'unknown'} command=${listener.command || 'unknown'}`
      );
    }
    process.exit(1);
  }

  for (const listener of processes) {
    console.warn(
      `[API] Reclaiming stale api dev process PID ${listener.pid} on ${targetPort}.`
    );
    try {
      process.kill(listener.pid, 'SIGTERM');
    } catch (error) {
      console.warn(`[API] Failed to send SIGTERM to PID ${listener.pid}:`, error);
    }
  }

  const targetPids = processes.map((listener) => listener.pid);
  const termReleased =
    (await waitForPortRelease(targetPort, 5000)) &&
    (await waitForProcessExit(targetPids, 5000, excludedPids));
  if (termReleased) {
    return;
  }

  const remaining = [
    ...describeListeners(targetPort),
    ...describePotentialApiDevProcesses(excludedPids),
  ].filter((listener, index, items) => items.findIndex((entry) => entry.pid === listener.pid) === index)
   .filter(isSameApiProcess)
   .filter((listener) => !excludedPids.has(listener.pid));
  for (const listener of remaining) {
    console.warn(
      `[API] PID ${listener.pid} did not exit after SIGTERM. Sending SIGKILL to release port ${targetPort}.`
    );
    try {
      process.kill(listener.pid, 'SIGKILL');
    } catch (error) {
      console.warn(`[API] Failed to send SIGKILL to PID ${listener.pid}:`, error);
    }
  }

  const killReleased =
    (await waitForPortRelease(targetPort, 2000)) &&
    (await waitForProcessExit(remaining.map((listener) => listener.pid), 2000, excludedPids));
  if (killReleased) {
    return;
  }

  console.error(`[API] Port ${targetPort} is still occupied after reclaim attempt.`);
  for (const listener of describeListeners(targetPort)) {
    console.error(
      `[API] PID ${listener.pid} cwd=${listener.cwd || 'unknown'} command=${listener.command || 'unknown'}`
    );
  }
  process.exit(1);
}

async function main() {
  if (!['darwin', 'linux'].includes(process.platform)) {
    console.warn(
      `[API] dev preflight skips automatic port reclaim on ${process.platform}.`
    );
    return;
  }

  try {
    await reclaimPort(port);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || 'unknown_error');
    if (message === 'lsof_not_found') {
      console.warn('[API] lsof is unavailable, skipping dev port reclaim.');
      return;
    }
    throw error;
  }
}

await main();
