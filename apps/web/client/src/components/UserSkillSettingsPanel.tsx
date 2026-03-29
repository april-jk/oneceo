import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
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

const EMPTY_FORM = {
  id: "",
  slug: "",
  name: "",
  description: "",
  category: "general",
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
          });
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
    });
  };

  const resetForm = () => {
    setEditingCustomSkillId("");
    setForm(EMPTY_FORM);
  };

  const handleSaveCustomSkill = async () => {
    const payload = {
      slug: normalizeSlug(form.slug || form.name),
      name: asText(form.name),
      description: asText(form.description),
      category: asText(form.category) || "general",
      bodyMarkdown: form.bodyMarkdown,
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
      await loadSettings();
      notifyTaskCreationSkillsUpdated();
    } catch (error) {
      onError?.(error instanceof Error ? error.message : "自定义技能保存失败");
    } finally {
      setBusyKey("");
    }
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
        <div>
          <Label className="text-sm font-medium">自定义 skills</Label>
          <p className="text-sm text-muted-foreground">
            这里维护你自己的技能正文，保存后可以直接在用户态 attachment picker 中使用。
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
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

          <div className="space-y-4 rounded-2xl border border-border/60 bg-muted/20 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <Label className="text-sm font-medium">
                  {editingCustomSkillId ? "编辑自定义 skill" : "新建自定义 skill"}
                </Label>
                <p className="text-sm text-muted-foreground">
                  slug 创建后建议保持稳定，便于后续在 sandbox 内识别。
                </p>
              </div>
              {editingCustomSkillId ? (
                <Button type="button" variant="outline" className="rounded-xl" onClick={resetForm}>
                  新建模式
                </Button>
              ) : null}
            </div>

            <div className="grid gap-4">
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
              <div className="space-y-2">
                <Label className="text-sm">Skill 正文</Label>
                <Textarea
                  value={form.bodyMarkdown}
                  onChange={(event) => setForm((prev) => ({ ...prev, bodyMarkdown: event.target.value }))}
                  rows={14}
                  className="rounded-xl font-mono text-xs"
                />
              </div>
              <div className="flex gap-3">
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
                <Button type="button" variant="outline" className="rounded-xl" onClick={() => void loadSettings()}>
                  刷新
                </Button>
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-border/60 bg-background/80 p-4 text-sm text-muted-foreground">
          当前已启用平台模板 {enabledPlatformIds.size} 个，自定义 active skills{" "}
          {(settings?.customSkills || []).filter((item) => item.status === "active").length} 个。
        </div>
      </section>
    </div>
  );
}
