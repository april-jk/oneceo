import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { e2bConnector } from '../connectors/e2b-connector';
import {
  pushDirectoryToManagedRepository,
  type ManagedDeploymentRepository,
} from './platform-managed-github-repo-service';

const execFile = promisify(execFileCallback);

const EXPORT_EXCLUDES = [
  '.git',
  '.opencode',
  'node_modules',
  '.cache',
  '.pnpm-store',
  '.idea',
  '.vscode',
];

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function shellEscape(value: string): string {
  if (!value) return "''";
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

async function extractArchive(archivePath: string, outputDir: string) {
  try {
    await execFile('tar', ['-xzf', archivePath, '-C', outputDir], {
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (error: any) {
    const stderr = typeof error?.stderr === 'string' ? error.stderr.trim() : '';
    throw new Error(stderr || '解压部署归档失败');
  }
}

async function exportWorkspaceToLocalDirectory(
  orchestratorSessionId: string,
  workspaceRoot: string
): Promise<string> {
  const normalizedSessionId = asText(orchestratorSessionId);
  const normalizedWorkspaceRoot = asText(workspaceRoot);
  if (!normalizedSessionId || !normalizedWorkspaceRoot) {
    throw new Error('缺少工作区信息，无法导出部署源码');
  }

  const sandboxArchivePath = `/tmp/oneceo-deployment-source-${Date.now()}.tar.gz`;
  const excludeArgs = EXPORT_EXCLUDES.map((item) => `--exclude=${item}`).join(' ');
  const command = [
    `test -d ${shellEscape(normalizedWorkspaceRoot)}`,
    `tar -czf ${shellEscape(sandboxArchivePath)} ${excludeArgs} -C ${shellEscape(normalizedWorkspaceRoot)} .`,
  ].join(' && ');

  await e2bConnector.runCommand(normalizedSessionId, command, {
    timeoutMs: 3 * 60 * 1000,
  });

  const archiveBytes = await e2bConnector.readFile(normalizedSessionId, sandboxArchivePath);
  await e2bConnector.runCommand(normalizedSessionId, `rm -f ${shellEscape(sandboxArchivePath)}`, {
    timeoutMs: 30 * 1000,
  }).catch(() => undefined);

  const localTempDir = await mkdtemp(join(tmpdir(), 'oneceo-deployment-src-'));
  const archivePath = join(localTempDir, 'workspace.tar.gz');
  await writeFile(archivePath, Buffer.from(archiveBytes));
  await extractArchive(archivePath, localTempDir);
  await rm(archivePath, { force: true });
  return localTempDir;
}

export async function publishTaskSessionWorkspaceToRepository(input: {
  orchestratorSessionId: string;
  workspaceRoot: string;
  repository: ManagedDeploymentRepository;
  sessionId: string;
}) {
  const sourceDir = await exportWorkspaceToLocalDirectory(input.orchestratorSessionId, input.workspaceRoot);
  try {
    await pushDirectoryToManagedRepository(input.repository, sourceDir, {
      commitMessage: `chore: deploy session ${input.sessionId} ${new Date().toISOString()}`,
    });
  } finally {
    await rm(sourceDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
