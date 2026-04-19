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
import i18n from "@/i18n";
import { useTranslation } from "react-i18next";

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
  return new Date(value).toLocaleString(i18n.language === "zh" ? "zh-CN" : "en-US", {
    hour12: false,
  });
}

function formatResourceSummary(skill: TaskCreationPlatformSkill) {
  const summary = skill.resourceSummary;
  if (!summary || summary.totalCount <= 0) {
    return i18n.t("userSkillSettings.noExtraResources");
  }
  return i18n.t("userSkillSettings.resourceSummary", {
    references: summary.referenceCount,
    templates: summary.templateCount,
  });
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
  useTranslation();
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
      onError?.(
        error instanceof Error ? error.message : i18n.t("userSkillSettings.loadFailed"),
      );
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
      onError?.(
        error instanceof Error
          ? error.message
          : i18n.t("userSkillSettings.updatePlatformFailed"),
      );
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
      onError?.(
        error instanceof Error
          ? error.message
          : i18n.t("userSkillSettings.saveCustomFailed"),
      );
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
      onError?.(
        error instanceof Error
          ? error.message
          : i18n.t("userSkillSettings.toggleCustomFailed"),
      );
    } finally {
      setBusyKey("");
    }
  };

  return (
    <div className="space-y-8">
      <section className="space-y-4 border-b border-border/60 pb-6">
        <div>
          <Label className="text-sm font-medium">
            {i18n.t("userSkillSettings.availableSkills")}
          </Label>
          <p className="text-sm text-muted-foreground">
            {i18n.t("userSkillSettings.availableSkillsDescription")}
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
                  {item.sourceType === "custom"
                    ? i18n.t("userSkillSettings.customSource")
                    : i18n.t("userSkillSettings.platformSource")}
                </span>
                {item.resourceSummary?.totalCount ? (
                  <span className="text-muted-foreground">{formatResourceSummary(item)}</span>
                ) : null}
              </span>
            ))}
            {!settings?.availableSkills.length ? (
              <span className="text-sm text-muted-foreground">
                {i18n.t("userSkillSettings.noAvailableSkill")}
              </span>
            ) : null}
          </div>
        </div>
      </section>

      <section className="space-y-4 border-b border-border/60 pb-6">
        <div>
          <Label className="text-sm font-medium">
            {i18n.t("userSkillSettings.platformTemplates")}
          </Label>
          <p className="text-sm text-muted-foreground">
            {i18n.t("userSkillSettings.platformTemplatesDescription")}
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
                <p className="text-sm text-muted-foreground">
                  {skill.description || i18n.t("userSkillSettings.noDescription")}
                </p>
                <p className="text-xs text-muted-foreground">{formatResourceSummary(skill)}</p>
              </div>
              <Button
                type="button"
                variant={skill.enabled ? "outline" : "default"}
                className="rounded-xl"
                disabled={busyKey === `platform:${skill.skillId}`}
                onClick={() => void handleTogglePlatformSkill(skill)}
              >
                {skill.enabled
                  ? i18n.t("userSkillSettings.removeFromMySkills")
                  : i18n.t("userSkillSettings.addToMySkills")}
              </Button>
            </div>
          ))}
          {loading && !settings ? (
            <p className="text-sm text-muted-foreground">
              {i18n.t("userSkillSettings.loading")}
            </p>
          ) : null}
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <Label className="text-sm font-medium">
              {i18n.t("userSkillSettings.customSkills")}
            </Label>
            <p className="text-sm text-muted-foreground">
              {i18n.t("userSkillSettings.customSkillsDescription")}
            </p>
          </div>
          <Button type="button" className="rounded-xl" onClick={startCreateCustomSkill}>
            {i18n.t("userSkillSettings.newSkills")}
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
                  <p className="text-sm text-muted-foreground">
                    {skill.description || i18n.t("userSkillSettings.noDescription")}
                  </p>
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
                    {i18n.t("userSkillSettings.edit")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="rounded-xl"
                    disabled={busyKey === `custom:status:${skill.id}`}
                    onClick={() => void handleToggleCustomStatus(skill)}
                  >
                    {skill.status === "archived"
                      ? i18n.t("userSkillSettings.enable")
                      : i18n.t("userSkillSettings.archive")}
                  </Button>
                </div>
              </div>
            </div>
          ))}
          {!settings?.customSkills.length ? (
            <p className="text-sm text-muted-foreground">
              {i18n.t("userSkillSettings.noCustomSkill")}
            </p>
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
                {editingCustomSkillId
                  ? i18n.t("userSkillSettings.editCustomSkill")
                  : i18n.t("userSkillSettings.newCustomSkill")}
              </DialogTitle>
              <DialogDescription className="text-sm text-muted-foreground">
                {i18n.t("userSkillSettings.editorDescription")}
              </DialogDescription>
            </DialogHeader>
            <div className="min-h-0 flex-1 overflow-hidden px-6 py-5">
              <div className="grid h-full gap-5 lg:grid-cols-[260px_minmax(0,1fr)] lg:items-start">
                <div className="space-y-4 overflow-y-auto pr-1 lg:h-full lg:pr-2">
                  <div className="rounded-2xl border border-border/60 bg-muted/20 p-4">
                    <div className="space-y-3">
                      <div className="space-y-2">
                        <Label className="text-sm">{i18n.t("userSkillSettings.slug")}</Label>
                        <Input
                          value={form.slug}
                          onChange={(event) => setForm((prev) => ({ ...prev, slug: event.target.value }))}
                          placeholder="my-custom-skill"
                          className="rounded-xl"
                          disabled={Boolean(editingCustomSkillId)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-sm">{i18n.t("userSkillSettings.name")}</Label>
                        <Input
                          value={form.name}
                          onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                          placeholder={i18n.t("userSkillSettings.namePlaceholder")}
                          className="rounded-xl"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-sm">{i18n.t("userSkillSettings.category")}</Label>
                        <Input
                          value={form.category}
                          onChange={(event) => setForm((prev) => ({ ...prev, category: event.target.value }))}
                          placeholder="general"
                          className="rounded-xl"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-sm">
                          {i18n.t("userSkillSettings.description")}
                        </Label>
                        <Input
                          value={form.description}
                          onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
                          placeholder={i18n.t("userSkillSettings.descriptionPlaceholder")}
                          className="rounded-xl"
                        />
                      </div>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-border/60 bg-background/70 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <Label className="text-sm font-medium">
                          {i18n.t("userSkillSettings.documents")}
                        </Label>
                        <p className="text-xs text-muted-foreground">
                          {i18n.t("userSkillSettings.documentsDescription")}
                        </p>
                      </div>
                      <Button type="button" variant="outline" className="rounded-xl" onClick={addDocument}>
                        {i18n.t("userSkillSettings.addDocument")}
                      </Button>
                    </div>
                    <div className="mt-4 space-y-2">
                      {form.documents.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-border/60 px-3 py-4 text-xs text-muted-foreground">
                          {i18n.t("userSkillSettings.noDocuments")}
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
                            <div className="text-sm font-medium">
                              {item.title ||
                                item.documentPath ||
                                i18n.t("userSkillSettings.documentDefaultTitle", {
                                  index: index + 1,
                                })}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {item.documentPath || i18n.t("userSkillSettings.unsetPath")}
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                </div>

                <div className="space-y-5 overflow-y-auto pr-1 lg:h-full lg:pr-2">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <Label className="text-sm">{i18n.t("userSkillSettings.body")}</Label>
                      <span className="text-xs text-muted-foreground">
                        {i18n.t("userSkillSettings.bodyDescription")}
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
                              <Label className="text-sm">
                                {i18n.t("userSkillSettings.documentPath")}
                              </Label>
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
                              <Label className="text-sm">
                                {i18n.t("userSkillSettings.documentKey")}
                              </Label>
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
                              <Label className="text-sm">
                                {i18n.t("userSkillSettings.documentTitle")}
                              </Label>
                              <Input
                                value={selectedDocument.title}
                                onChange={(event) =>
                                  updateDocument(selectedDocumentIndex, { title: event.target.value })
                                }
                                placeholder={i18n.t("userSkillSettings.documentTitlePlaceholder")}
                                className="rounded-xl"
                              />
                            </div>
                            <div className="space-y-2">
                              <Label className="text-sm">
                                {i18n.t("userSkillSettings.documentSummary")}
                              </Label>
                              <Input
                                value={selectedDocument.summary}
                                onChange={(event) =>
                                  updateDocument(selectedDocumentIndex, { summary: event.target.value })
                                }
                                placeholder={i18n.t("userSkillSettings.documentSummaryPlaceholder")}
                                className="rounded-xl"
                              />
                            </div>
                          </div>
                          <div className="space-y-2">
                            <Label className="text-sm">
                              {i18n.t("userSkillSettings.documentMarkdown")}
                            </Label>
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
                              {i18n.t("userSkillSettings.deleteDocument")}
                            </Button>
                          </div>
                        </>
                      ) : (
                        <div className="rounded-xl border border-dashed border-border/60 px-4 py-6 text-sm text-muted-foreground">
                          {i18n.t("userSkillSettings.selectDocumentHint")}
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
                    {editingCustomSkillId
                      ? i18n.t("userSkillSettings.saveChanges")
                      : i18n.t("userSkillSettings.createSkill")}
                  </Button>
                  <Button type="button" variant="outline" className="rounded-xl" onClick={resetForm}>
                    {i18n.t("userSkillSettings.reset")}
                  </Button>
                </div>
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <div className="rounded-2xl border border-border/60 bg-background/80 p-4 text-sm text-muted-foreground">
          {i18n.t("userSkillSettings.enabledSummary", {
            platformCount: enabledPlatformIds.size,
            customCount: (settings?.customSkills || []).filter(
              (item) => item.status === "active",
            ).length,
          })}
        </div>
      </section>
    </div>
  );
}
