import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
  Check,
  ChevronDown,
  Code2,
  Loader2,
  Plus,
  Server,
  Settings,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  attachSessionConnector,
  saveSessionConnectorDraft,
  type ConnectorProfile,
} from "@/lib/connectors-client";
import {
  createCustomMcpProfile,
  deleteCustomMcpProfile,
  getCustomMcpEditableJson,
  importCustomMcpJson,
  testCustomMcpProfile,
  updateCustomMcpJson,
  updateCustomMcpProfile,
  type CustomMcpHeaderInput,
  type CustomMcpTransportType,
} from "@/lib/custom-mcp-client";
import {
  ensureSessionConnectorDraftId,
  listSessionConnectorDraftEntries,
  updateSessionConnectorDraftMetadata,
  upsertSessionConnectorDraftEntry,
} from "@/lib/session-connector-draft";
import { closeSettingsDialog } from "@/lib/settings-dialog-events";
import { cn } from "@/lib/utils";

type Props = {
  profiles: ConnectorProfile[];
  query: string;
  targetSessionId?: string | null;
  onProfilesChanged: () => Promise<void> | void;
};

type HeaderRow = CustomMcpHeaderInput & { id: string };

type FormState = {
  profileName: string;
  transportType: CustomMcpTransportType;
  iconUrl: string;
  description: string;
  serverUrl: string;
  headers: HeaderRow[];
  enabled: boolean;
};

const emptyForm: FormState = {
  profileName: "",
  transportType: "streamable_http",
  iconUrl: "",
  description: "",
  serverUrl: "",
  headers: [],
  enabled: true,
};

function asText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function profileToForm(profile: ConnectorProfile): FormState {
  const config = profile.config || {};
  const headerNames = Array.isArray(config.headerNames)
    ? config.headerNames.map((item) => asText(item)).filter(Boolean)
    : [];
  return {
    profileName: profile.profileName,
    transportType: (asText(config.transportType) || "streamable_http") as CustomMcpTransportType,
    iconUrl: asText(config.iconUrl),
    description: asText(config.description),
    serverUrl: asText(config.serverUrl),
    headers: headerNames.map((name) => ({ id: crypto.randomUUID(), name, value: "" })),
    enabled: config.enabled !== false,
  };
}

function validateLocalConfig(input: FormState | string) {
  const errors: string[] = [];
  if (typeof input === "string") {
    const lowered = input.toLowerCase();
    if (/"type"\s*:\s*"stdio"/.test(lowered) || /"transport"\s*:\s*"stdio"/.test(lowered)) {
      errors.push("当前平台暂不支持 stdio / 本地类型 MCP。");
    }
    if (/"command"\s*:/.test(lowered) || /"args"\s*:/.test(lowered) || /"env"\s*:/.test(lowered) || /"cwd"\s*:/.test(lowered)) {
      errors.push("JSON 中不能包含 command / args / env / cwd。");
    }
    return errors;
  }
  if (!input.profileName.trim()) errors.push("请输入服务器名称。");
  if (!["streamable_http", "http", "sse"].includes(input.transportType)) {
    errors.push("传输类型只能是 HTTP、Streamable HTTP 或 SSE。");
  }
  if (!input.serverUrl.trim()) {
    errors.push("请输入服务器 URL。");
  } else if (!input.serverUrl.trim().startsWith("https://")) {
    errors.push("服务器 URL 必须使用 https://。");
  }
  const seen = new Set<string>();
  for (const header of input.headers) {
    const name = header.name.trim().toLowerCase();
    if (!name && !header.value.trim()) continue;
    if (!name) errors.push("Header 名称不能为空。");
    if (/[\r\n:]/.test(header.name)) errors.push("Header 名称不能包含冒号或换行。");
    if (/[\r\n]/.test(header.value)) errors.push("Header 值不能包含换行。");
    if (seen.has(name)) errors.push(`Header 重复：${header.name}`);
    seen.add(name);
  }
  return errors;
}

function hostFromUrl(value: unknown) {
  try {
    return new URL(asText(value)).host;
  } catch {
    return asText(value);
  }
}

export function CustomMcpManagementPanel({ profiles, query, targetSessionId, onProfilesChanged }: Props) {
  const [, setLocation] = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [jsonOpen, setJsonOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState<ConnectorProfile | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [jsonText, setJsonText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const normalizedQuery = query.trim().toLowerCase();
  const filteredProfiles = useMemo(() => {
    if (!normalizedQuery) return profiles;
    return profiles.filter((profile) => {
      const config = profile.config || {};
      return [
        profile.profileName,
        profile.displayName,
        config.serverUrl,
        hostFromUrl(config.serverUrl),
        config.description,
      ]
        .map((value) => asText(value).toLowerCase())
        .some((value) => value.includes(normalizedQuery));
    });
  }, [normalizedQuery, profiles]);

  const openCreateForm = () => {
    setEditingProfile(null);
    setForm(emptyForm);
    setFormOpen(true);
    setMenuOpen(false);
  };

  const openEditForm = (profile: ConnectorProfile) => {
    setEditingProfile(profile);
    setForm(profileToForm(profile));
    setFormOpen(true);
  };

  const openImportJson = () => {
    setEditingProfile(null);
    setJsonText(
      JSON.stringify(
        {
          mcpServers: {
            "my-remote-mcp": {
              type: "streamable_http",
              url: "https://mcp.example.com/mcp",
              headers: {},
              description: "",
            },
          },
        },
        null,
        2
      )
    );
    setJsonOpen(true);
    setMenuOpen(false);
  };

  const openEditJson = async (profile: ConnectorProfile) => {
    setBusy(`json:${profile.profileId}`);
    try {
      const editable = await getCustomMcpEditableJson(profile.profileId);
      setEditingProfile(profile);
      setJsonText(JSON.stringify(editable, null, 2));
      setJsonOpen(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "读取 JSON 失败");
    } finally {
      setBusy(null);
    }
  };

  const saveForm = async () => {
    const errors = validateLocalConfig(form);
    if (errors.length > 0) {
      toast.error(errors[0]);
      return;
    }
    setBusy("save");
    try {
      const payload = {
        profileName: form.profileName.trim(),
        transportType: form.transportType,
        serverUrl: form.serverUrl.trim(),
        iconUrl: form.iconUrl.trim(),
        description: form.description.trim(),
        enabled: form.enabled,
        headers: form.headers
          .map((header) => ({ name: header.name.trim(), value: header.value.trim() }))
          .filter((header) => header.name && header.value),
      };
      const saved = editingProfile
        ? await updateCustomMcpProfile(editingProfile.profileId, payload)
        : await createCustomMcpProfile(payload);
      if (targetSessionId) {
        await attachSessionConnector(targetSessionId, "custom_mcp", {
          profileId: saved.profileId,
        });
      }
      await onProfilesChanged();
      setFormOpen(false);
      toast.success(targetSessionId ? "Custom MCP 已保存并挂载" : "Custom MCP 已保存");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存 Custom MCP 失败");
    } finally {
      setBusy(null);
    }
  };

  const saveJson = async () => {
    const errors = validateLocalConfig(jsonText);
    if (errors.length > 0) {
      toast.error(errors[0]);
      return;
    }
    setBusy("json-save");
    try {
      JSON.parse(jsonText);
      if (editingProfile) {
        await updateCustomMcpJson(editingProfile.profileId, jsonText);
        toast.success("Custom MCP JSON 已保存");
      } else {
        const result = await importCustomMcpJson(jsonText);
        toast.success(`已导入 ${result.created.length} 个，拒绝 ${result.rejected.length} 个`);
      }
      await onProfilesChanged();
      setJsonOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存 JSON 失败");
    } finally {
      setBusy(null);
    }
  };

  const formatJson = () => {
    try {
      setJsonText(JSON.stringify(JSON.parse(jsonText), null, 2));
    } catch {
      toast.error("JSON 格式不合法，无法格式化");
    }
  };

  const deleteProfile = async (profile: ConnectorProfile) => {
    if (!window.confirm(`确认删除 ${profile.profileName}？已挂载会话会被解除。`)) return;
    setBusy(`delete:${profile.profileId}`);
    try {
      await deleteCustomMcpProfile(profile.profileId);
      await onProfilesChanged();
      toast.success("Custom MCP 已删除");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "删除失败");
    } finally {
      setBusy(null);
    }
  };

  const testProfile = async (profile: ConnectorProfile) => {
    setBusy(`test:${profile.profileId}`);
    try {
      const result = await testCustomMcpProfile(profile.profileId);
      await onProfilesChanged();
      toast.success(`连接可用，发现 ${result.tools.length} 个工具`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "测试失败");
    } finally {
      setBusy(null);
    }
  };

  const useProfile = async (profile: ConnectorProfile) => {
    setBusy(`use:${profile.profileId}`);
    try {
      const draftState = upsertSessionConnectorDraftEntry("custom_mcp", {
        profileId: profile.profileId,
        desiredState: "attached",
        sessionConfig: null,
        enabledTools: [],
      }, {
        source: "manual",
        sourceProjectId: undefined,
        userTouched: true,
      });
      updateSessionConnectorDraftMetadata({
        source: "manual",
        sourceProjectId: undefined,
        userTouched: true,
      });
      await saveSessionConnectorDraft(
        draftState?.draftId || ensureSessionConnectorDraftId(),
        listSessionConnectorDraftEntries()
      );
      const connectorName = profile.profileName || profile.displayName || "Custom MCP";
      const prompt = `帮我测试 ${connectorName} 连接器，并演示如何使用它的功能`;
      setFormOpen(false);
      setJsonOpen(false);
      setMenuOpen(false);
      closeSettingsDialog();
      setLocation(`/new-task?prefill=${encodeURIComponent(prompt)}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "启动 Custom MCP 测试对话失败");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="grid h-full min-h-[440px] grid-cols-1 gap-4 lg:grid-cols-[minmax(260px,0.95fr)_minmax(320px,1fr)]">
      <div className="space-y-2">
        <Popover open={menuOpen} onOpenChange={setMenuOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="flex min-h-[88px] w-full items-center justify-center gap-3 rounded-lg border border-border/70 bg-muted/20 px-4 py-4 text-sm font-semibold transition hover:border-foreground/20 hover:bg-muted/35"
            >
              <Plus className="h-5 w-5" />
              添加自定义 MCP 服务器
              <ChevronDown className="h-4 w-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[260px] rounded-lg p-2">
            <button
              type="button"
              className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm hover:bg-muted"
              onClick={openImportJson}
            >
              <Code2 className="h-4 w-4" />
              通过 JSON 导入
            </button>
            <button
              type="button"
              className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm hover:bg-muted"
              onClick={openCreateForm}
            >
              <Settings className="h-4 w-4" />
              直接配置
            </button>
          </PopoverContent>
        </Popover>
        <div className="rounded-lg border border-border/70 bg-background p-3 text-xs text-muted-foreground">
          仅支持远程 HTTP、Streamable HTTP、SSE MCP。stdio、本地命令、command/args/env/cwd 配置会被拒绝保存。
        </div>
      </div>

      <div className="space-y-3">
        {filteredProfiles.length === 0 ? (
          <div className="flex min-h-[180px] flex-col items-center justify-center rounded-lg border border-dashed border-border/70 px-4 text-center text-sm text-muted-foreground">
            暂无自定义 MCP。可以通过 JSON 导入或直接配置远程 MCP 服务。
          </div>
        ) : (
          filteredProfiles.map((profile) => {
            const config = profile.config || {};
            const enabled = config.enabled !== false;
            const busyKey = busy?.endsWith(profile.profileId);
            return (
              <div
                key={profile.profileId}
                className="group rounded-lg border border-border/70 bg-card px-4 py-4 transition hover:border-foreground/15 hover:bg-muted/20"
              >
                <div className="flex items-start gap-3">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-background">
                    <Server className="h-5 w-5 text-foreground/70" />
                  </div>
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => openEditForm(profile)}
                  >
                    <div className="truncate text-sm font-semibold">{profile.profileName}</div>
                    <div className="mt-1 truncate text-xs text-muted-foreground">
                      {asText(config.transportType) || "streamable_http"} · {hostFromUrl(config.serverUrl)}
                    </div>
                    {profile.lastError ? (
                      <div className="mt-1 truncate text-xs text-destructive">{profile.lastError}</div>
                    ) : null}
                  </button>
                  <div className="flex items-center gap-1">
                    {enabled && profile.authStatus === "authorized" ? (
                      <Check className="h-4 w-4 text-emerald-600" />
                    ) : (
                      <X className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={() => testProfile(profile)} disabled={busyKey}>
                    {busy === `test:${profile.profileId}` ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    测试连接
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => useProfile(profile)} disabled={busyKey}>
                    {busy === `use:${profile.profileId}` ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    试用一下
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => openEditJson(profile)} disabled={busyKey}>
                    <Code2 className="mr-2 h-4 w-4" />
                    编辑 JSON
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => deleteProfile(profile)} disabled={busyKey}>
                    <Trash2 className="mr-2 h-4 w-4 text-destructive" />
                    删除
                  </Button>
                </div>
              </div>
            );
          })
        )}
      </div>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-[760px] rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              MCP 配置
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>服务器名称</Label>
              <Input value={form.profileName} onChange={(event) => setForm({ ...form, profileName: event.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>传输类型</Label>
              <Select
                value={form.transportType}
                onValueChange={(value) => setForm({ ...form, transportType: value as CustomMcpTransportType })}
              >
                <SelectTrigger className="h-10 w-full rounded-xl bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                  <SelectItem value="streamable_http">Streamable HTTP</SelectItem>
                  <SelectItem value="http">HTTP</SelectItem>
                  <SelectItem value="sse">SSE</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label>图标（可选）</Label>
            <Input placeholder="粘贴 URL" value={form.iconUrl} onChange={(event) => setForm({ ...form, iconUrl: event.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>备注（可选）</Label>
            <Textarea
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
              placeholder="提供 MCP 文档或说明，以告知 Altus 如何及何时使用此 MCP"
              className="min-h-[96px]"
            />
          </div>
          <div className="space-y-2">
            <Label>服务器 URL</Label>
            <Input value={form.serverUrl} onChange={(event) => setForm({ ...form, serverUrl: event.target.value })} placeholder="https://mcp.example.com/mcp" />
          </div>
          <div className="space-y-2">
            <Label>自定义 headers（可选）</Label>
            <div className="space-y-2">
              {form.headers.map((header) => (
                <div key={header.id} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                  <Input placeholder="Header name" value={header.name} onChange={(event) => setForm({
                    ...form,
                    headers: form.headers.map((item) => item.id === header.id ? { ...item, name: event.target.value } : item),
                  })} />
                  <Input placeholder="Header value" value={header.value} onChange={(event) => setForm({
                    ...form,
                    headers: form.headers.map((item) => item.id === header.id ? { ...item, value: event.target.value } : item),
                  })} />
                  <Button variant="outline" size="icon" onClick={() => setForm({ ...form, headers: form.headers.filter((item) => item.id !== header.id) })}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button variant="outline" onClick={() => setForm({ ...form, headers: [...form.headers, { id: crypto.randomUUID(), name: "", value: "" }] })}>
                <Plus className="mr-2 h-4 w-4" />
                添加自定义 header
              </Button>
            </div>
          </div>
          <div className="flex items-center justify-between pt-3">
            <Button variant="outline" onClick={() => editingProfile ? openEditJson(editingProfile) : openImportJson()}>
              <Code2 className="mr-2 h-4 w-4" />
              编辑 JSON
            </Button>
            <div className="flex gap-2">
              {editingProfile ? (
                <Button variant="outline" onClick={() => testProfile(editingProfile)}>
                  测试连接
                </Button>
              ) : null}
              <Button onClick={saveForm} disabled={busy === "save"}>
                {busy === "save" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                保存
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={jsonOpen} onOpenChange={setJsonOpen}>
        <DialogContent className="max-w-[780px] rounded-2xl">
          <DialogHeader>
            <DialogTitle>{editingProfile ? "编辑 JSON" : "通过 JSON 导入"}</DialogTitle>
          </DialogHeader>
          <Textarea
            value={jsonText}
            onChange={(event) => setJsonText(event.target.value)}
            className={cn("min-h-[360px] font-mono text-xs", validateLocalConfig(jsonText).length > 0 && "border-destructive")}
          />
          {validateLocalConfig(jsonText).length > 0 ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {validateLocalConfig(jsonText)[0]}
            </div>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={formatJson}>
              格式化
            </Button>
            <Button onClick={saveJson} disabled={busy === "json-save" || validateLocalConfig(jsonText).length > 0}>
              {busy === "json-save" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              保存 JSON
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
