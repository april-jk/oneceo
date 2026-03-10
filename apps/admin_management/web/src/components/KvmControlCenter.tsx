import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { KvmJobInfo, KvmSessionInfo, KvmSnapshotInfo, VmDetailResponse, VmItem, VmMetricsInfo } from '../types';

type Props = {
  vms: VmItem[];
  onDataChanged: () => Promise<void>;
  onError: (message: string) => void;
};

function parseArgsInput(input: string) {
  return input
    .split('\n')
    .flatMap((line) => line.split(' '))
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseEnvInput(input: string) {
  const output: Record<string, string> = {};
  for (const line of input.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.includes('=')) continue;
    const [key, ...rest] = trimmed.split('=');
    output[key.trim()] = rest.join('=').trim();
  }
  return output;
}

function stringifySafe(input: unknown) {
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
}

function toLogText(payload: Record<string, unknown>) {
  const candidate =
    payload.lines ||
    payload.logs ||
    payload.entries ||
    payload.items ||
    payload.content ||
    payload.data;

  if (typeof candidate === 'string') {
    return candidate;
  }
  if (Array.isArray(candidate)) {
    return candidate
      .map((item) => {
        if (typeof item === 'string') return item;
        return stringifySafe(item);
      })
      .join('\n');
  }
  return stringifySafe(payload);
}

export function KvmControlCenter({ vms, onDataChanged, onError }: Props) {
  const [selectedVmId, setSelectedVmId] = useState<string | null>(null);
  const [vmDetail, setVmDetail] = useState<VmDetailResponse | null>(null);
  const [vmMetrics, setVmMetrics] = useState<VmMetricsInfo | null>(null);
  const [vmLogs, setVmLogs] = useState<string>('');
  const [vmSnapshots, setVmSnapshots] = useState<KvmSnapshotInfo[]>([]);
  const [vmActionAsync, setVmActionAsync] = useState(false);
  const [vmExecPath, setVmExecPath] = useState('/bin/echo');
  const [vmExecArgs, setVmExecArgs] = useState('hello');
  const [vmExecEnv, setVmExecEnv] = useState('');
  const [vmExecResult, setVmExecResult] = useState<Record<string, unknown> | null>(null);
  const [snapshotName, setSnapshotName] = useState('');
  const [snapshotDescription, setSnapshotDescription] = useState('');
  const [snapshotRestoreState, setSnapshotRestoreState] = useState('running');
  const [vmUploadFile, setVmUploadFile] = useState<File | null>(null);
  const [vmUploadTargetPath, setVmUploadTargetPath] = useState('agent');
  const [vmDeleteTargetPath, setVmDeleteTargetPath] = useState('agent');
  const [vmFileResult, setVmFileResult] = useState<Record<string, unknown> | null>(null);

  const [sessionIdInput, setSessionIdInput] = useState('');
  const [sessionBindVmName, setSessionBindVmName] = useState('');
  const [sessionBindAutoAllocate, setSessionBindAutoAllocate] = useState(false);
  const [sessionInfo, setSessionInfo] = useState<KvmSessionInfo | null>(null);
  const [sessionVmInfo, setSessionVmInfo] = useState<Record<string, unknown> | null>(null);
  const [sessionQuota, setSessionQuota] = useState({
    maxActionsPerMinute: 120,
    maxRuntimeMinutes: 240,
    maxRebootsPerHour: 20,
  });
  const [sessionExecPath, setSessionExecPath] = useState('/bin/echo');
  const [sessionExecArgs, setSessionExecArgs] = useState('session command');
  const [sessionExecResult, setSessionExecResult] = useState<Record<string, unknown> | null>(null);

  const [sandboxCreateSessionId, setSandboxCreateSessionId] = useState('');
  const [sandboxCreateVmName, setSandboxCreateVmName] = useState('');
  const [sandboxLookupSessionId, setSandboxLookupSessionId] = useState('');
  const [sandboxDetail, setSandboxDetail] = useState<Record<string, unknown> | null>(null);
  const [sandboxPortVmPort, setSandboxPortVmPort] = useState(8080);
  const [sandboxPortHostPort, setSandboxPortHostPort] = useState(18080);
  const [sandboxPortsResult, setSandboxPortsResult] = useState<Record<string, unknown> | null>(null);

  const [jobLookupId, setJobLookupId] = useState('');
  const [jobInfo, setJobInfo] = useState<KvmJobInfo | null>(null);
  const [eventsInfo, setEventsInfo] = useState<{ url: string; replayLast: number } | null>(null);

  const loadSelectedVm = useCallback(async (vmId: string) => {
    const [detailResult, metricsResult, logsResult, snapshotsResult] = await Promise.allSettled([
      api.getVmDetail(vmId),
      api.getVmMetrics(vmId),
      api.getVmLogs(vmId, 160),
      api.listVmSnapshots(vmId),
    ]);

    setVmDetail(detailResult.status === 'fulfilled' ? detailResult.value : null);
    setVmMetrics(metricsResult.status === 'fulfilled' ? metricsResult.value : null);
    setVmLogs(logsResult.status === 'fulfilled' ? toLogText(logsResult.value) : '');
    setVmSnapshots(snapshotsResult.status === 'fulfilled' ? snapshotsResult.value : []);
  }, []);

  useEffect(() => {
    if (selectedVmId && vms.some((vm) => vm.vmId === selectedVmId)) {
      return;
    }
    setSelectedVmId(vms[0]?.vmId || null);
  }, [selectedVmId, vms]);

  useEffect(() => {
    if (!selectedVmId) return;
    void loadSelectedVm(selectedVmId);
  }, [loadSelectedVm, selectedVmId]);

  const handleVmAction = async (action: 'start' | 'shutdown' | 'reboot' | 'suspend' | 'resume') => {
    if (!selectedVmId) return;
    try {
      const result = await api.runVmAction(selectedVmId, { action, async: vmActionAsync, operator: 'admin-ui' });
      if (typeof result.jobId === 'string') {
        setJobLookupId(result.jobId);
      }
      await onDataChanged();
      await loadSelectedVm(selectedVmId);
    } catch (error) {
      onError(error instanceof Error ? error.message : '执行 VM 动作失败');
    }
  };

  const handleVmExec = async () => {
    if (!selectedVmId || !vmExecPath.trim()) return;
    try {
      const result = await api.vmExec(selectedVmId, {
        path: vmExecPath.trim(),
        args: parseArgsInput(vmExecArgs),
        captureOutput: true,
        timeoutSeconds: 60,
        env: parseEnvInput(vmExecEnv),
      });
      setVmExecResult(result);
    } catch (error) {
      onError(error instanceof Error ? error.message : 'VM exec 失败');
    }
  };

  const handleCreateSnapshot = async () => {
    if (!selectedVmId || !snapshotName.trim()) return;
    try {
      await api.createVmSnapshot(selectedVmId, {
        snapshotName: snapshotName.trim(),
        description: snapshotDescription.trim() || undefined,
      });
      setSnapshotName('');
      setSnapshotDescription('');
      await loadSelectedVm(selectedVmId);
    } catch (error) {
      onError(error instanceof Error ? error.message : '创建快照失败');
    }
  };

  const handleSnapshotAction = async (mode: 'restore' | 'delete', snapshotNameInput: string) => {
    if (!selectedVmId) return;
    try {
      if (mode === 'restore') {
        await api.restoreVmSnapshot(selectedVmId, snapshotNameInput, {
          targetState: snapshotRestoreState,
        });
      } else {
        await api.deleteVmSnapshot(selectedVmId, snapshotNameInput);
      }
      await loadSelectedVm(selectedVmId);
    } catch (error) {
      onError(error instanceof Error ? error.message : '快照操作失败');
    }
  };

  const handleVmUploadFile = async () => {
    if (!selectedVmId || !vmUploadFile) return;
    try {
      const formData = new FormData();
      formData.append('file', vmUploadFile);
      formData.append('targetPath', vmUploadTargetPath || 'agent');
      const result = await api.uploadVmFile(selectedVmId, formData);
      setVmFileResult(result);
    } catch (error) {
      onError(error instanceof Error ? error.message : '上传 VM 文件失败');
    }
  };

  const handleVmDeleteFile = async () => {
    if (!selectedVmId || !vmDeleteTargetPath.trim()) return;
    try {
      const result = await api.deleteVmFile(selectedVmId, {
        targetPath: vmDeleteTargetPath.trim(),
        recursive: true,
      });
      setVmFileResult(result);
    } catch (error) {
      onError(error instanceof Error ? error.message : '删除 VM 文件失败');
    }
  };

  const handleCreateSession = async () => {
    try {
      const result = await api.createSession({
        metadata: { owner: 'admin-management', source: 'kvm-control-center' },
      });
      setSessionInfo(result);
      setSessionIdInput(result.sessionId);
    } catch (error) {
      onError(error instanceof Error ? error.message : '创建 session 失败');
    }
  };

  const handleLoadSession = async () => {
    if (!sessionIdInput.trim()) return;
    try {
      const result = await api.getSession(sessionIdInput.trim());
      setSessionInfo(result);
      const quota = await api.getSessionQuota(sessionIdInput.trim()).catch(() => null);
      if (quota?.quota) {
        setSessionQuota(quota.quota);
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : '查询 session 失败');
    }
  };

  const handleSessionAction = async (action: 'bind' | 'getVm' | 'close' | 'updateQuota' | 'exec') => {
    if (!sessionIdInput.trim()) return;
    try {
      if (action === 'bind') {
        const result = await api.bindSessionVm(sessionIdInput.trim(), {
          vmName: sessionBindVmName.trim() || undefined,
          autoAllocate: sessionBindAutoAllocate || undefined,
        });
        setSessionVmInfo(result);
      } else if (action === 'getVm') {
        const result = await api.getSessionVm(sessionIdInput.trim());
        setSessionVmInfo(result);
      } else if (action === 'close') {
        await api.closeSession(sessionIdInput.trim(), { gracefulShutdown: true });
      } else if (action === 'updateQuota') {
        await api.updateSessionQuota(sessionIdInput.trim(), sessionQuota);
      } else {
        const result = await api.sessionExec(sessionIdInput.trim(), {
          path: sessionExecPath.trim(),
          args: parseArgsInput(sessionExecArgs),
          captureOutput: true,
          timeoutSeconds: 60,
        });
        setSessionExecResult(result);
      }
      await handleLoadSession();
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Session 操作失败');
    }
  };

  const handleCreateSandbox = async () => {
    try {
      const result = await api.createSandbox({
        sessionId: sandboxCreateSessionId.trim() || undefined,
        vmName: sandboxCreateVmName.trim() || undefined,
        memoryMb: 2048,
        vcpus: 2,
        autoBind: true,
        start: true,
      });
      setSandboxDetail(result);
      if (typeof result.sessionId === 'string') {
        setSandboxLookupSessionId(result.sessionId);
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : '创建 sandbox 失败');
    }
  };

  const handleLoadSandbox = async () => {
    if (!sandboxLookupSessionId.trim()) return;
    try {
      const result = await api.getSandbox(sandboxLookupSessionId.trim());
      setSandboxDetail(result as unknown as Record<string, unknown>);
    } catch (error) {
      onError(error instanceof Error ? error.message : '查询 sandbox 失败');
    }
  };

  const handleSandboxAction = async (action: 'restart' | 'delete' | 'createPort' | 'listPort' | 'deletePort') => {
    if (!sandboxLookupSessionId.trim()) return;
    try {
      if (action === 'restart') {
        const result = await api.restartSandbox(sandboxLookupSessionId.trim(), { gracefulShutdown: true, start: true });
        setSandboxDetail(result);
      } else if (action === 'delete') {
        const result = await api.deleteSandbox(sandboxLookupSessionId.trim(), true);
        setSandboxDetail(result);
      } else if (action === 'createPort') {
        const result = await api.createSandboxPortMapping(sandboxLookupSessionId.trim(), {
          vmPort: sandboxPortVmPort,
          hostPort: sandboxPortHostPort,
          protocol: 'tcp',
        });
        setSandboxPortsResult(result);
      } else if (action === 'listPort') {
        const result = await api.listSandboxPortMappings(sandboxLookupSessionId.trim(), {
          refresh: true,
          verify: true,
          waitSeconds: 5,
        });
        setSandboxPortsResult(typeof result === 'object' ? (result as Record<string, unknown>) : { result });
      } else {
        const result = await api.deleteSandboxPortMapping(sandboxLookupSessionId.trim(), {
          hostPort: sandboxPortHostPort,
          protocol: 'tcp',
        });
        setSandboxPortsResult(result);
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Sandbox 操作失败');
    }
  };

  const handleJobLookup = async () => {
    if (!jobLookupId.trim()) return;
    try {
      const result = await api.getJob(jobLookupId.trim());
      setJobInfo(result);
    } catch (error) {
      onError(error instanceof Error ? error.message : '查询 job 失败');
    }
  };

  const handleLoadWsInfo = async () => {
    try {
      const result = await api.getEventsWsUrl(20);
      setEventsInfo(result);
    } catch (error) {
      onError(error instanceof Error ? error.message : '获取事件 WS 地址失败');
    }
  };

  return (
    <section className="panel fade-in">
      <div className="panel-header">
        <h2>KVM 全量控制台（单机 / Session / Sandbox / Job）</h2>
      </div>
      <div className="control-grid">
        <article className="sub-panel">
          <h3>单机控制</h3>
          <div className="form-grid">
            <label>
              选择 VM
              <select value={selectedVmId || ''} onChange={(event) => setSelectedVmId(event.target.value || null)}>
                {vms.map((vm) => (
                  <option key={vm.vmId} value={vm.vmId}>
                    {vm.vmId}
                  </option>
                ))}
              </select>
            </label>
            <label className="inline-check">
              <input
                type="checkbox"
                checked={vmActionAsync}
                onChange={(event) => setVmActionAsync(event.target.checked)}
              />
              动作异步执行
            </label>
          </div>
          <div className="button-grid">
            <button type="button" className="secondary-btn" onClick={() => handleVmAction('start')}>
              启动
            </button>
            <button type="button" className="secondary-btn" onClick={() => handleVmAction('shutdown')}>
              关机
            </button>
            <button type="button" className="secondary-btn" onClick={() => handleVmAction('reboot')}>
              重启
            </button>
            <button type="button" className="secondary-btn" onClick={() => handleVmAction('suspend')}>
              挂起
            </button>
            <button type="button" className="secondary-btn" onClick={() => handleVmAction('resume')}>
              恢复
            </button>
          </div>
          <div className="form-grid">
            <label>
              命令路径
              <input value={vmExecPath} onChange={(event) => setVmExecPath(event.target.value)} />
            </label>
            <label>
              参数（空格/换行）
              <textarea rows={2} value={vmExecArgs} onChange={(event) => setVmExecArgs(event.target.value)} />
            </label>
            <label>
              环境变量（KEY=VALUE）
              <textarea rows={2} value={vmExecEnv} onChange={(event) => setVmExecEnv(event.target.value)} />
            </label>
          </div>
          <div className="action-inline">
            <button type="button" className="primary-btn" onClick={handleVmExec}>
              执行 VM 命令
            </button>
          </div>
          <pre className="json-block">{vmDetail ? stringifySafe(vmDetail) : '暂无 VM 详情'}</pre>
          <pre className="json-block">{vmMetrics ? stringifySafe(vmMetrics) : '暂无 VM 指标'}</pre>
          <pre className="json-block">{vmLogs || '暂无 VM 日志'}</pre>
          <pre className="json-block">{vmExecResult ? stringifySafe(vmExecResult) : '暂无命令执行结果'}</pre>
        </article>

        <article className="sub-panel">
          <h3>快照与文件</h3>
          <div className="form-grid">
            <label>
              快照名称
              <input value={snapshotName} onChange={(event) => setSnapshotName(event.target.value)} />
            </label>
            <label>
              快照描述
              <input value={snapshotDescription} onChange={(event) => setSnapshotDescription(event.target.value)} />
            </label>
            <label>
              恢复目标状态
              <input value={snapshotRestoreState} onChange={(event) => setSnapshotRestoreState(event.target.value)} />
            </label>
          </div>
          <div className="action-inline">
            <button type="button" className="secondary-btn" onClick={handleCreateSnapshot}>
              创建快照
            </button>
          </div>
          <div className="compact-list">
            {vmSnapshots.map((snapshot) => (
              <article key={snapshot.snapshotName} className="compact-item">
                <div>
                  <p className="mono">{snapshot.snapshotName}</p>
                </div>
                <div className="action-inline">
                  <button
                    type="button"
                    className="table-btn"
                    onClick={() => handleSnapshotAction('restore', snapshot.snapshotName)}
                  >
                    恢复
                  </button>
                  <button
                    type="button"
                    className="table-btn danger"
                    onClick={() => handleSnapshotAction('delete', snapshot.snapshotName)}
                  >
                    删除
                  </button>
                </div>
              </article>
            ))}
          </div>
          <div className="form-grid">
            <label>
              上传文件
              <input type="file" onChange={(event) => setVmUploadFile(event.target.files?.[0] || null)} />
            </label>
            <label>
              上传目标路径
              <input value={vmUploadTargetPath} onChange={(event) => setVmUploadTargetPath(event.target.value)} />
            </label>
            <label>
              删除目标路径
              <input value={vmDeleteTargetPath} onChange={(event) => setVmDeleteTargetPath(event.target.value)} />
            </label>
          </div>
          <div className="action-inline">
            <button type="button" className="secondary-btn" onClick={handleVmUploadFile} disabled={!vmUploadFile}>
              上传文件
            </button>
            <button type="button" className="secondary-btn" onClick={handleVmDeleteFile}>
              删除路径
            </button>
          </div>
          <pre className="json-block">{vmFileResult ? stringifySafe(vmFileResult) : '暂无文件操作结果'}</pre>
        </article>

        <article className="sub-panel">
          <h3>Session 管理</h3>
          <div className="form-grid">
            <label>
              Session ID
              <input value={sessionIdInput} onChange={(event) => setSessionIdInput(event.target.value)} />
            </label>
            <label>
              bind.vmName
              <input value={sessionBindVmName} onChange={(event) => setSessionBindVmName(event.target.value)} />
            </label>
            <label className="inline-check">
              <input
                type="checkbox"
                checked={sessionBindAutoAllocate}
                onChange={(event) => setSessionBindAutoAllocate(event.target.checked)}
              />
              自动分配 VM
            </label>
          </div>
          <div className="button-grid">
            <button type="button" className="primary-btn" onClick={handleCreateSession}>
              创建 session
            </button>
            <button type="button" className="secondary-btn" onClick={handleLoadSession}>
              查询 session
            </button>
            <button type="button" className="secondary-btn" onClick={() => handleSessionAction('bind')}>
              绑定 session
            </button>
            <button type="button" className="secondary-btn" onClick={() => handleSessionAction('getVm')}>
              查询 session VM
            </button>
            <button type="button" className="table-btn danger" onClick={() => handleSessionAction('close')}>
              关闭 session
            </button>
          </div>
          <div className="form-grid">
            <label>
              maxActionsPerMinute
              <input
                type="number"
                value={sessionQuota.maxActionsPerMinute}
                onChange={(event) =>
                  setSessionQuota((prev) => ({ ...prev, maxActionsPerMinute: Number(event.target.value) || prev.maxActionsPerMinute }))
                }
              />
            </label>
            <label>
              maxRuntimeMinutes
              <input
                type="number"
                value={sessionQuota.maxRuntimeMinutes}
                onChange={(event) =>
                  setSessionQuota((prev) => ({ ...prev, maxRuntimeMinutes: Number(event.target.value) || prev.maxRuntimeMinutes }))
                }
              />
            </label>
            <label>
              maxRebootsPerHour
              <input
                type="number"
                value={sessionQuota.maxRebootsPerHour}
                onChange={(event) =>
                  setSessionQuota((prev) => ({ ...prev, maxRebootsPerHour: Number(event.target.value) || prev.maxRebootsPerHour }))
                }
              />
            </label>
            <label>
              session exec path
              <input value={sessionExecPath} onChange={(event) => setSessionExecPath(event.target.value)} />
            </label>
            <label>
              session exec args
              <textarea rows={2} value={sessionExecArgs} onChange={(event) => setSessionExecArgs(event.target.value)} />
            </label>
          </div>
          <div className="button-grid">
            <button type="button" className="secondary-btn" onClick={() => handleSessionAction('updateQuota')}>
              更新 quota
            </button>
            <button type="button" className="secondary-btn" onClick={() => handleSessionAction('exec')}>
              session exec
            </button>
          </div>
          <pre className="json-block">{sessionInfo ? stringifySafe(sessionInfo) : '暂无 session 数据'}</pre>
          <pre className="json-block">{sessionVmInfo ? stringifySafe(sessionVmInfo) : '暂无 session VM 数据'}</pre>
          <pre className="json-block">{sessionExecResult ? stringifySafe(sessionExecResult) : '暂无 session exec 数据'}</pre>
        </article>

        <article className="sub-panel">
          <h3>Sandbox / Job / 事件</h3>
          <div className="form-grid">
            <label>
              create.sessionId
              <input value={sandboxCreateSessionId} onChange={(event) => setSandboxCreateSessionId(event.target.value)} />
            </label>
            <label>
              create.vmName
              <input value={sandboxCreateVmName} onChange={(event) => setSandboxCreateVmName(event.target.value)} />
            </label>
            <label>
              lookup.sessionId
              <input value={sandboxLookupSessionId} onChange={(event) => setSandboxLookupSessionId(event.target.value)} />
            </label>
            <label>
              vmPort
              <input
                type="number"
                value={sandboxPortVmPort}
                onChange={(event) => setSandboxPortVmPort(Number(event.target.value) || 8080)}
              />
            </label>
            <label>
              hostPort
              <input
                type="number"
                value={sandboxPortHostPort}
                onChange={(event) => setSandboxPortHostPort(Number(event.target.value) || 18080)}
              />
            </label>
            <label>
              jobId
              <input value={jobLookupId} onChange={(event) => setJobLookupId(event.target.value)} />
            </label>
          </div>
          <div className="button-grid">
            <button type="button" className="primary-btn" onClick={handleCreateSandbox}>
              创建 sandbox
            </button>
            <button type="button" className="secondary-btn" onClick={handleLoadSandbox}>
              查询 sandbox
            </button>
            <button type="button" className="secondary-btn" onClick={() => handleSandboxAction('restart')}>
              重启 sandbox
            </button>
            <button type="button" className="table-btn danger" onClick={() => handleSandboxAction('delete')}>
              删除 sandbox
            </button>
            <button type="button" className="secondary-btn" onClick={() => handleSandboxAction('createPort')}>
              创建端口映射
            </button>
            <button type="button" className="secondary-btn" onClick={() => handleSandboxAction('listPort')}>
              查询端口映射
            </button>
            <button type="button" className="secondary-btn" onClick={() => handleSandboxAction('deletePort')}>
              删除端口映射
            </button>
            <button type="button" className="secondary-btn" onClick={handleJobLookup}>
              查询 job
            </button>
            <button type="button" className="secondary-btn" onClick={handleLoadWsInfo}>
              获取事件 WS 地址
            </button>
          </div>
          <pre className="json-block">{sandboxDetail ? stringifySafe(sandboxDetail) : '暂无 sandbox 数据'}</pre>
          <pre className="json-block">{sandboxPortsResult ? stringifySafe(sandboxPortsResult) : '暂无端口映射数据'}</pre>
          <pre className="json-block">{jobInfo ? stringifySafe(jobInfo) : '暂无 job 数据'}</pre>
          <pre className="json-block">{eventsInfo ? stringifySafe(eventsInfo) : '暂无 WS 地址'}</pre>
        </article>
      </div>
    </section>
  );
}
