import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  activateTaskCreationCustomSkill,
  archiveTaskCreationCustomSkill,
  createTaskCreationCustomSkill,
  disableTaskCreationPlatformSkill,
  enableTaskCreationPlatformSkill,
  getTaskCreationUserSkillSettings,
  updateTaskCreationCustomSkill,
  type TaskCreationPlatformSkill,
  type TaskCreationUserCustomSkill,
  type TaskCreationUserSkillSettings,
} from "@/lib/task-creation-client";
import { notifyTaskCreationSkillsUpdated } from "@/lib/settings-dialog-events";

function asText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeSlug(value: string) {
  return asText(value)
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function formatResourceSummary(skill: TaskCreationPlatformSkill) {
  const summary = skill.resourceSummary;
  if (!summary || summary.totalCount <= 0) {
    return "无额外资源";
  }
  return `${summary.referenceCount} 个参考，${summary.templateCount} 个模板`;
}

const EMPTY_FORM = {
  id: "",
  slug: "",
  name: "",
  description: "",
  category: "general",
  bodyMarkdown: "",
  documents: [] as Array<{
    documentKey: string;
    documentPath: string;
    title: string;
    summary: string;
    bodyMarkdown: string;
  }>,
};

const EMPTY_DOCUMENT = {
  documentKey: "",
  documentPath: "",
  title: "",
  summary: "",
  bodyMarkdown: "",
};

type Props = {
  onError?: (message: string) => void;
};

export function UserSkillSettingsPanel({ onError }: Props) {
  const [settings, setSettings] = useState<TaskCreationUserSkillSettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyKey, setBusyKey] = useState("");
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingCustomSkillId, setEditingCustomSkillId] = useState("");
  const [selectedDocumentIndex, setSelectedDocumentIndex] = useState(0);
  const [editorOpen, setEditorOpen] = useState(false);

  const loadSettings = async () => {
    setLoading(true);
    try {
      const next = await getTaskCreationUserSkillSettings();
      setSettings(next);
      if (editingCustomSkillId) {
        const current = next.customSkills.find((item) => item.id === editingCustomSkillId);
        if (current) {
          setForm({
            id: current.id,
            slug: current.slug,
            name: current.name,
            description: current.description,
            category: current.category,
            bodyMarkdown: current.bodyMarkdown || "",
            documents: (current.documents || []).map((item) => ({
              documentKey: item.documentKey,
              documentPath: item.documentPath,
              title: item.title,
              summary: item.summary,
              bodyMarkdown: item.bodyMarkdown,
            })),
          });
          setSelectedDocumentIndex(0);
        }
      }
    } catch (error) {
      onError?.(error instanceof Error ? error.message : "技能设置加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadSettings();
  }, []);

  const enabledPlatformIds = useMemo(
    () =>
      new Set(
        (settings?.platformCatalog || [])
          .filter((item) => item.enabled)
          .map((item) => item.skillId)
      ),
    [settings]
  );

  const handleTogglePlatformSkill = async (skill: TaskCreationPlatformSkill & { enabled?: boolean }) => {
    const actionKey = `platform:${skill.skillId}`;
    setBusyKey(actionKey);
    try {
      if (skill.enabled) {
        await disableTaskCreationPlatformSkill(skill.skillId);
      } else {
        await enableTaskCreationPlatformSkill(skill.skillId);
      }
      await loadSettings();
      notifyTaskCreationSkillsUpdated();
    } catch (error) {
      onError?.(error instanceof Error ? error.message : "平台模板更新失败");
    } finally {
      setBusyKey("");
    }
  };

  const startEditCustomSkill = (skill: TaskCreationUserCustomSkill) => {
    setEditingCustomSkillId(skill.id);
    setForm({
      id: skill.id,
      slug: skill.slug,
      name: skill.name,
      description: skill.description,
      category: skill.category,
      bodyMarkdown: skill.bodyMarkdown || "",
      documents: (skill.documents || []).map((item) => ({
        documentKey: item.documentKey,
        documentPath: item.documentPath,
        title: item.title,
        summary: item.summary,
        bodyMarkdown: item.bodyMarkdown,
      })),
    });
    setSelectedDocumentIndex(0);
    setEditorOpen(true);
  };

  const resetForm = () => {
    setEditingCustomSkillId("");
    setForm(EMPTY_FORM);
    setSelectedDocumentIndex(0);
  };

  const startCreateCustomSkill = () => {
    resetForm();
    setEditorOpen(true);
  };

  const handleSaveCustomSkill = async () => {
    const payload = {
      slug: normalizeSlug(form.slug || form.name),
      name: asText(form.name),
      description: asText(form.description),
      category: asText(form.category) || "general",
      bodyMarkdown: form.bodyMarkdown,
      documents: form.documents
        .map((item, index) => ({
          documentKey: normalizeSlug(item.documentKey || item.documentPath || `doc-${index + 1}`),
          documentPath: asText(item.documentPath),
          title: asText(item.title),
          summary: asText(item.summary),
          bodyMarkdown: item.bodyMarkdown,
        }))
        .filter((item) => item.documentPath && asText(item.bodyMarkdown)),
    };
    const actionKey = editingCustomSkillId ? `custom:update:${editingCustomSkillId}` : "custom:create";
    setBusyKey(actionKey);
    try {
      if (editingCustomSkillId) {
        await updateTaskCreationCustomSkill(editingCustomSkillId, payload);
      } else {
        await createTaskCreationCustomSkill(payload);
      }
      resetForm();
      setEditorOpen(false);
      await loadSettings();
      notifyTaskCreationSkillsUpdated();
    } catch (error) {
      onError?.(error instanceof Error ? error.message : "自定义技能保存失败");
    } finally {
      setBusyKey("");
    }
  };

  const selectedDocument = form.documents[selectedDocumentIndex] || null;

  const updateDocument = (index: number, patch: Partial<(typeof EMPTY_DOCUMENT)>) => {
    setForm((prev) => ({
      ...prev,
      documents: prev.documents.map((item, currentIndex) =>
        currentIndex === index ? { ...item, ...patch } : item
      ),
    }));
  };

  const addDocument = () => {
    setForm((prev) => ({
      ...prev,
      documents: [...prev.documents, { ...EMPTY_DOCUMENT, documentKey: `doc-${prev.documents.length + 1}` }],
    }));
    setSelectedDocumentIndex(form.documents.length);
  };

  const removeDocument = (index: number) => {
    setForm((prev) => ({
      ...prev,
      documents: prev.documents.filter((_, currentIndex) => currentIndex !== index),
    }));
    setSelectedDocumentIndex((prev) => Math.max(0, Math.min(prev, form.documents.length - 2)));
  };

  const handleToggleCustomStatus = async (skill: TaskCreationUserCustomSkill) => {
    const actionKey = `custom:status:${skill.id}`;
    setBusyKey(actionKey);
    try {
      if (skill.status === "archived") {
        await activateTaskCreationCustomSkill(skill.id);
      } else {
        await archiveTaskCreationCustomSkill(skill.id);
      }
      await loadSettings();
      notifyTaskCreationSkillsUpdated();
    } catch (error) {
      onError?.(error instanceof Error ? error.message : "自定义技能状态更新失败");
    } finally {
      setBusyKey("");
    }
  };

  return (
    <div className="space-y-8">
      <section className="space-y-4 border-b border-border/60 pb-6">
        <div>
          <Label className="text-sm font-medium">当前可用 skills</Label>
          <p className="text-sm text-muted-foreground">
            attachment picker 只会展示这里配置后的可用 skills。
          </p>
        </div>
        <div className="rounded-2xl border border-border/60 bg-muted/20 p-4">
          <div className="flex flex-wrap gap-2">
            {(settings?.availableSkills || []).map((item) => (
              <span
                key={`${item.sourceType || "platform"}:${item.skillId}:${item.revisionId}`}
                className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-background px-3 py-1 text-xs"
              >
                <span>{item.name}</span>
                <span className="text-muted-foreground">
                  {item.sourceType === "custom" ? "自定义" : "平台"}
                </span>
                {item.resourceSummary?.totalCount ? (
                  <span className="text-muted-foreground">{formatResourceSummary(item)}</span>
                ) : null}
              </span>
            ))}
            {!settings?.availableSkills.length ? (
              <span className="text-sm text-muted-foreground">暂无可用 skill</span>
            ) : null}
          </div>
        </div>
      </section>

      <section className="space-y-4 border-b border-border/60 pb-6">
        <div>
          <Label className="text-sm font-medium">平台模板</Label>
          <p className="text-sm text-muted-foreground">
            这些模板由管理端维护。启用后会直接进入你的可用 skills，并始终跟随平台最新 published revision。
          </p>
        </div>
        <div className="space-y-3">
          {(settings?.platformCatalog || []).map((skill) => (
            <div
              key={skill.skillId}
              className="flex flex-col gap-3 rounded-2xl border border-border/60 bg-background/80 p-4 md:flex-row md:items-start md:justify-between"
            >
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-foreground">{skill.name}</span>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                    {skill.category}
                  </span>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                    rev.{skill.revisionNumber ?? "-"}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">{skill.description || "暂无描述"}</p>
                <p className="text-xs text-muted-foreground">{formatResourceSummary(skill)}</p>
              </div>
              <Button
                type="button"
                variant={skill.enabled ? "outline" : "default"}
                className="rounded-xl"
                disabled={busyKey === `platform:${skill.skillId}`}
                onClick={() => void handleTogglePlatformSkill(skill)}
              >
                {skill.enabled ? "移出我的 skills" : "加入我的 skills"}
              </Button>
            </div>
          ))}
          {loading && !settings ? <p className="text-sm text-muted-foreground">加载中...</p> : null}
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <Label className="text-sm font-medium">自定义 skills</Label>
            <p className="text-sm text-muted-foreground">
              这里维护你自己的纯数据库型技能。主正文会直接进入 skill 入口，渐进式文档会以 markdown 资源方式存储，按需在运行时加载。
            </p>
          </div>
          <Button type="button" className="rounded-xl" onClick={startCreateCustomSkill}>
            新增 skills
          </Button>
        </div>

        <div className="space-y-3">
          {(settings?.customSkills || []).map((skill) => (
            <div key={skill.id} className="rounded-2xl border border-border/60 bg-background/80 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-foreground">{skill.name}</span>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                      {skill.status}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">{skill.description || "暂无描述"}</p>
                  <p className="text-xs text-muted-foreground">
                    {skill.slug} · {formatDateTime(skill.updatedAt)}
                  </p>
                </div>
                <div className="flex flex-col gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="rounded-xl"
                    onClick={() => startEditCustomSkill(skill)}
                  >
                    编辑
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="rounded-xl"
                    disabled={busyKey === `custom:status:${skill.id}`}
                    onClick={() => void handleToggleCustomStatus(skill)}
                  >
                    {skill.status === "archived" ? "启用" : "归档"}
                  </Button>
                </div>
              </div>
            </div>
          ))}
          {!settings?.customSkills.length ? (
            <p className="text-sm text-muted-foreground">还没有自定义 skill。</p>
          ) : null}
        </div>

        <Dialog
          open={editorOpen}
          onOpenChange={(open) => {
            setEditorOpen(open);
            if (!open) resetForm();
          }}
        >
          <DialogContent className="flex h-[min(760px,calc(100vh-48px))] w-[min(921px,calc(100vw-32px))] max-w-[921px] flex-col rounded-3xl p-0 gap-0 overflow-hidden md:w-[min(973px,calc(100vw-32px))] md:max-w-[973px]">
            <DialogHeader className="border-b border-border/60 px-6 py-5 text-left">
              <DialogTitle className="text-lg text-foreground">
                {editingCustomSkillId ? "编辑自定义 skill" : "新建自定义 skill"}
              </DialogTitle>
              <DialogDescription className="text-sm text-muted-foreground">
                用户态只支持纯数据库型 skills。文档相对路径会固定恢复到用户 skill 根目录下。
              </DialogDescription>
            </DialogHeader>
            <div className="min-h-0 flex-1 overflow-hidden px-6 py-5">
              <div className="grid h-full gap-5 lg:grid-cols-[260px_minmax(0,1fr)] lg:items-start">
                <div className="space-y-4 overflow-y-auto pr-1 lg:h-full lg:pr-2">
                  <div className="rounded-2xl border border-border/60 bg-muted/20 p-4">
                    <div className="space-y-3">
                      <div className="space-y-2">
                        <Label className="text-sm">Slug</Label>
                        <Input
                          value={form.slug}
                          onChange={(event) => setForm((prev) => ({ ...prev, slug: event.target.value }))}
                          placeholder="my-custom-skill"
                          className="rounded-xl"
                          disabled={Boolean(editingCustomSkillId)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-sm">名称</Label>
                        <Input
                          value={form.name}
                          onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                          placeholder="我的自定义 skill"
                          className="rounded-xl"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-sm">分类</Label>
                        <Input
                          value={form.category}
                          onChange={(event) => setForm((prev) => ({ ...prev, category: event.target.value }))}
                          placeholder="general"
                          className="rounded-xl"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-sm">描述</Label>
                        <Input
                          value={form.description}
                          onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
                          placeholder="说明这个 skill 解决什么问题"
                          className="rounded-xl"
                        />
                      </div>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-border/60 bg-background/70 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <Label className="text-sm font-medium">渐进式文档</Label>
                        <p className="text-xs text-muted-foreground">
                          选择左侧文档后在右侧编辑正文。
                        </p>
                      </div>
                      <Button type="button" variant="outline" className="rounded-xl" onClick={addDocument}>
                        新增文档
                      </Button>
                    </div>
                    <div className="mt-4 space-y-2">
                      {form.documents.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-border/60 px-3 py-4 text-xs text-muted-foreground">
                          还没有渐进式文档。可以添加 `references/overview.md`、`design/rules.md` 这类纯 markdown 文档。
                        </div>
                      ) : (
                        form.documents.map((item, index) => (
                          <button
                            key={`${item.documentKey || "doc"}:${index}`}
                            type="button"
                            className={`w-full rounded-xl border px-3 py-3 text-left ${
                              selectedDocumentIndex === index
                                ? "border-primary bg-primary/5"
                                : "border-border/60 bg-background"
                            }`}
                            onClick={() => setSelectedDocumentIndex(index)}
                          >
                            <div className="text-sm font-medium">{item.title || item.documentPath || `文档 ${index + 1}`}</div>
                            <div className="text-xs text-muted-foreground">{item.documentPath || "未设置路径"}</div>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                </div>

                <div className="space-y-5 overflow-y-auto pr-1 lg:h-full lg:pr-2">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <Label className="text-sm">Skill 正文</Label>
                      <span className="text-xs text-muted-foreground">
                        作为主入口说明直接参与 skill 激活
                      </span>
                    </div>
                    <Textarea
                      value={form.bodyMarkdown}
                      onChange={(event) => setForm((prev) => ({ ...prev, bodyMarkdown: event.target.value }))}
                      rows={16}
                      className="min-h-[280px] rounded-xl font-mono text-xs"
                    />
                  </div>

                  <div className="rounded-2xl border border-border/60 bg-background/70 p-4">
                    <div className="space-y-3">
                      {selectedDocument ? (
                        <>
                          <div className="grid gap-3 md:grid-cols-2">
                            <div className="space-y-2">
                              <Label className="text-sm">文档路径</Label>
                              <Input
                                value={selectedDocument.documentPath}
                                onChange={(event) =>
                                  updateDocument(selectedDocumentIndex, { documentPath: event.target.value })
                                }
                                placeholder="references/overview.md"
                                className="rounded-xl"
                              />
                            </div>
                            <div className="space-y-2">
                              <Label className="text-sm">文档 Key</Label>
                              <Input
                                value={selectedDocument.documentKey}
                                onChange={(event) =>
                                  updateDocument(selectedDocumentIndex, { documentKey: event.target.value })
                                }
                                placeholder="overview"
                                className="rounded-xl"
                              />
                            </div>
                          </div>
                          <div className="grid gap-3 md:grid-cols-2">
                            <div className="space-y-2">
                              <Label className="text-sm">标题</Label>
                              <Input
                                value={selectedDocument.title}
                                onChange={(event) =>
                                  updateDocument(selectedDocumentIndex, { title: event.target.value })
                                }
                                placeholder="总体说明"
                                className="rounded-xl"
                              />
                            </div>
                            <div className="space-y-2">
                              <Label className="text-sm">摘要</Label>
                              <Input
                                value={selectedDocument.summary}
                                onChange={(event) =>
                                  updateDocument(selectedDocumentIndex, { summary: event.target.value })
                                }
                                placeholder="告诉模型这份文档适合什么时候读"
                                className="rounded-xl"
                              />
                            </div>
                          </div>
                          <div className="space-y-2">
                            <Label className="text-sm">Markdown 文档</Label>
                            <Textarea
                              value={selectedDocument.bodyMarkdown}
                              onChange={(event) =>
                                updateDocument(selectedDocumentIndex, { bodyMarkdown: event.target.value })
                              }
                              rows={12}
                              className="min-h-[240px] rounded-xl font-mono text-xs"
                            />
                          </div>
                          <div className="flex justify-end">
                            <Button
                              type="button"
                              variant="outline"
                              className="rounded-xl"
                              onClick={() => removeDocument(selectedDocumentIndex)}
                            >
                              删除当前文档
                            </Button>
                          </div>
                        </>
                      ) : (
                        <div className="rounded-xl border border-dashed border-border/60 px-4 py-6 text-sm text-muted-foreground">
                          选择左侧文档进行编辑，或先新增一份渐进式文档。
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col gap-3 sm:flex-row">
                  <Button
                    type="button"
                    className="rounded-xl"
                    disabled={
                      !normalizeSlug(form.slug || form.name) ||
                      !asText(form.name) ||
                      !asText(form.bodyMarkdown) ||
                      busyKey === "custom:create" ||
                      busyKey === `custom:update:${editingCustomSkillId}`
                    }
                    onClick={() => void handleSaveCustomSkill()}
                  >
                    {editingCustomSkillId ? "保存修改" : "创建 skill"}
                  </Button>
                  <Button type="button" variant="outline" className="rounded-xl" onClick={resetForm}>
                    重置
                  </Button>
                </div>
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <div className="rounded-2xl border border-border/60 bg-background/80 p-4 text-sm text-muted-foreground">
          当前已启用平台模板 {enabledPlatformIds.size} 个，自定义 active skills{" "}
          {(settings?.customSkills || []).filter((item) => item.status === "active").length} 个。
        </div>
      </section>
    </div>
  );
}
