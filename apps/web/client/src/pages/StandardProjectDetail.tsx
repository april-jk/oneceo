import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ArrowLeft, CalendarClock, CheckCircle2, Clock3, FolderOpen, MessageSquareText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  listTaskCreationProjects,
  listTaskCreationSessions,
  type TaskCreationProjectSummary,
  type TaskCreationSessionSummary,
} from "@/lib/task-creation-client";

interface StandardProjectDetailProps {
  projectId?: string | null;
  onBack?: () => void;
  onOpenSession?: (sessionId: string) => void;
}

function formatDateLabel(value?: string | null, locale?: string) {
  if (!value) return "—";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return "—";
  return new Intl.DateTimeFormat(locale || undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(parsed));
}

export default function StandardProjectDetail({
  projectId,
  onBack,
  onOpenSession,
}: StandardProjectDetailProps) {
  const { t, i18n } = useTranslation();
  const [project, setProject] = useState<TaskCreationProjectSummary | null>(null);
  const [sessions, setSessions] = useState<TaskCreationSessionSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let disposed = false;

    const load = async () => {
      if (!projectId) {
        setProject(null);
        setSessions([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        const [projects, allSessions] = await Promise.all([
          listTaskCreationProjects(),
          listTaskCreationSessions("all"),
        ]);
        if (disposed) return;

        const matchedProject =
          projects.find((item) => item.id === projectId) || null;
        const matchedSessions = allSessions
          .filter((session) => session.projectId === projectId)
          .sort((left, right) => {
            const leftTime = Date.parse(left.updatedAt || "");
            const rightTime = Date.parse(right.updatedAt || "");
            const safeLeft = Number.isFinite(leftTime) ? leftTime : 0;
            const safeRight = Number.isFinite(rightTime) ? rightTime : 0;
            return safeRight - safeLeft;
          });

        setProject(matchedProject);
        setSessions(matchedSessions);
      } catch (error) {
        if (disposed) return;
        toast.error(
          error instanceof Error && error.message.trim()
            ? error.message.trim()
            : t("standardProjectDetail.loadFailed"),
        );
      } finally {
        if (!disposed) {
          setLoading(false);
        }
      }
    };

    void load();
    return () => {
      disposed = true;
    };
  }, [projectId, t]);

  const completedCount = useMemo(
    () =>
      sessions.filter(
        (session) => (session.status || "").trim().toLowerCase() === "completed",
      ).length,
    [sessions],
  );
  const inProgressCount = Math.max(sessions.length - completedCount, 0);
  const latestUpdatedAt = useMemo(() => sessions[0]?.updatedAt || null, [sessions]);

  if (loading) {
    return (
      <div className="flex min-h-[calc(100vh-2rem)] items-center justify-center">
        <div className="text-sm text-muted-foreground">
          {t("standardProjectDetail.loading")}
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="mx-auto flex min-h-[calc(100vh-2rem)] w-full max-w-5xl flex-col px-4 py-8 sm:px-6 lg:px-8">
        {onBack ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={onBack}
            className="mb-4 w-fit gap-2"
          >
            <ArrowLeft className="h-4 w-4" />
            {t("standardProjectDetail.back")}
          </Button>
        ) : null}
        <div className="rounded-lg border border-border bg-background px-5 py-6">
          <div className="text-base font-medium text-foreground">
            {t("standardProjectDetail.notFoundTitle")}
          </div>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {t("standardProjectDetail.notFoundDescription")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-[calc(100vh-2rem)] w-full max-w-5xl flex-col px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex items-start justify-between gap-4 border-b border-border pb-5">
        <div className="min-w-0 flex-1">
          {onBack ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={onBack}
              className="mb-3 w-fit gap-2"
            >
              <ArrowLeft className="h-4 w-4" />
              {t("standardProjectDetail.back")}
            </Button>
          ) : null}
          <div className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
            {t("standardProjectDetail.eyebrow")}
          </div>
          <h1 className="mt-2 text-3xl font-semibold text-foreground">
            {project.name}
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            {project.description?.trim()
              ? project.description
              : t("standardProjectDetail.emptyDescription")}
          </p>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            {t("standardProjectDetail.pageHint")}
          </p>
        </div>
        <Badge
          variant="outline"
          className="rounded-md px-2.5 py-1 text-xs font-medium"
        >
          {t("standardProjectDetail.groupingBadge")}
        </Badge>
      </div>

      <div className="mt-6 grid gap-3 md:grid-cols-3">
        <div className="rounded-lg border border-border px-4 py-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <FolderOpen className="h-4 w-4" />
            {t("standardProjectDetail.sessionCount")}
          </div>
          <div className="mt-3 text-2xl font-semibold text-foreground">
            {sessions.length}
          </div>
        </div>
        <div className="rounded-lg border border-border px-4 py-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Clock3 className="h-4 w-4" />
            {t("standardProjectDetail.inProgressCount")}
          </div>
          <div className="mt-3 text-2xl font-semibold text-foreground">
            {inProgressCount}
          </div>
        </div>
        <div className="rounded-lg border border-border px-4 py-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="h-4 w-4" />
            {t("standardProjectDetail.completedCount")}
          </div>
          <div className="mt-3 text-2xl font-semibold text-foreground">
            {completedCount}
          </div>
        </div>
      </div>

      <div className="mt-6 rounded-lg border border-border">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <div className="text-base font-medium text-foreground">
              {t("standardProjectDetail.sessionListTitle")}
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              {t("standardProjectDetail.sessionListDescription")}
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CalendarClock className="h-4 w-4" />
            <span>
              {t("standardProjectDetail.lastActive", {
                value: formatDateLabel(latestUpdatedAt, i18n.language),
              })}
            </span>
          </div>
        </div>

        {sessions.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <div className="text-base font-medium text-foreground">
              {t("standardProjectDetail.emptyTitle")}
            </div>
            <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              {t("standardProjectDetail.emptyDescriptionLong")}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {sessions.map((session) => {
              const isCompleted =
                (session.status || "").trim().toLowerCase() === "completed";
              return (
                <Link
                  key={session.id}
                  href={`/session/${encodeURIComponent(session.id)}?view=history`}
                  onClick={(event) => {
                    if (!onOpenSession) return;
                    event.preventDefault();
                    onOpenSession(session.id);
                  }}
                >
                  <div className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-muted/30">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <MessageSquareText className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="truncate text-sm font-medium text-foreground">
                          {session.title?.trim()
                            ? session.title
                            : t("standardProjectDetail.untitledSession")}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span>
                          {t("standardProjectDetail.updatedAt", {
                            value: formatDateLabel(session.updatedAt, i18n.language),
                          })}
                        </span>
                        <span>·</span>
                        <span>
                          {isCompleted
                            ? t("standardProjectDetail.statusCompleted")
                            : t("standardProjectDetail.statusInProgress")}
                        </span>
                      </div>
                    </div>
                    <Badge
                      variant="outline"
                      className="rounded-md px-2.5 py-1 text-[11px] font-medium"
                    >
                      {isCompleted
                        ? t("standardProjectDetail.statusCompleted")
                        : t("standardProjectDetail.statusInProgress")}
                    </Badge>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
