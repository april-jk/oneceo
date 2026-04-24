import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { AnimatePresence, motion } from "framer-motion";
import { Search as SearchIcon, X, ArrowUpRight, Clock3 } from "lucide-react";
import { useTranslation } from "react-i18next";
import WorkspaceLayout from "@/components/WorkspaceLayout";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  searchTaskCreationSessions,
  type TaskCreationSessionSearchResult,
} from "@/lib/task-creation-client";

export function normalizeSearchPageQuery(value: string) {
  return value.trim().replace(/\s+/g, " ").slice(0, 100);
}

export function shouldTriggerSearchPage(query: string) {
  return normalizeSearchPageQuery(query).length >= 2;
}

export function groupSearchResultsByProject(results: TaskCreationSessionSearchResult[]) {
  const groups = new Map<
    string,
    {
      key: string;
      label: string;
      items: TaskCreationSessionSearchResult[];
      latestUpdatedAt: number;
    }
  >();

  for (const item of results) {
    const projectName =
      typeof item.projectName === "string" && item.projectName.trim()
        ? item.projectName.trim()
        : "";
    const key = projectName || "__ungrouped__";
    const label = projectName || "__ungrouped__";
    const existing = groups.get(key);
    const updatedAt = Date.parse(item.updatedAt || "");
    const safeUpdatedAt = Number.isFinite(updatedAt) ? updatedAt : 0;

    if (!existing) {
      groups.set(key, {
        key,
        label,
        items: [item],
        latestUpdatedAt: safeUpdatedAt,
      });
      continue;
    }

    existing.items.push(item);
    if (safeUpdatedAt > existing.latestUpdatedAt) {
      existing.latestUpdatedAt = safeUpdatedAt;
    }
  }

  return Array.from(groups.values()).sort((left, right) => {
    const leftUngrouped = left.key === "__ungrouped__";
    const rightUngrouped = right.key === "__ungrouped__";
    if (leftUngrouped !== rightUngrouped) {
      return Number(leftUngrouped) - Number(rightUngrouped);
    }
    if (right.latestUpdatedAt !== left.latestUpdatedAt) {
      return right.latestUpdatedAt - left.latestUpdatedAt;
    }
    if (right.items.length !== left.items.length) {
      return right.items.length - left.items.length;
    }
    return left.label.localeCompare(right.label);
  });
}

export default function Search() {
  const { t } = useTranslation();
  const [, setLocation] = useLocation();
  const search = useSearch();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const requestIdRef = useRef(0);
  const initialQuery = useMemo(() => {
    const params = new URLSearchParams(search);
    return normalizeSearchPageQuery(params.get("q") || "");
  }, [search]);
  const [query, setQuery] = useState(initialQuery);
  const [debouncedQuery, setDebouncedQuery] = useState(initialQuery);
  const [results, setResults] = useState<TaskCreationSessionSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setQuery(initialQuery);
    setDebouncedQuery(initialQuery);
  }, [initialQuery]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQuery(normalizeSearchPageQuery(query));
    }, 250);
    return () => {
      window.clearTimeout(timer);
    };
  }, [query]);

  useEffect(() => {
    const normalized = normalizeSearchPageQuery(query);
    const nextUrl = normalized ? `/search?q=${encodeURIComponent(normalized)}` : "/search";
    if (`${window.location.pathname}${window.location.search}` === nextUrl) {
      return;
    }
    window.history.replaceState(window.history.state, "", nextUrl);
  }, [query]);

  useEffect(() => {
    const normalized = normalizeSearchPageQuery(debouncedQuery);
    if (!shouldTriggerSearchPage(normalized)) {
      requestIdRef.current += 1;
      setResults([]);
      setLoading(false);
      setError("");
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoading(true);
    setError("");

    void searchTaskCreationSessions(normalized, 50)
      .then((nextResults) => {
        if (requestIdRef.current !== requestId) return;
        setResults(nextResults);
      })
      .catch((nextError) => {
        if (requestIdRef.current !== requestId) return;
        setResults([]);
        setError(
          nextError instanceof Error && nextError.message.trim()
            ? nextError.message.trim()
            : t("searchPage.searchFailed"),
        );
      })
      .finally(() => {
        if (requestIdRef.current !== requestId) return;
        setLoading(false);
      });
  }, [debouncedQuery, t]);

  const normalizedQuery = useMemo(() => normalizeSearchPageQuery(query), [query]);
  const groupedResults = useMemo(() => groupSearchResultsByProject(results), [results]);
  const shouldSearch = shouldTriggerSearchPage(normalizedQuery);
  const showResultsStage = shouldSearch || loading || Boolean(error) || results.length > 0;

  const formatUpdatedAt = (value?: string) => {
    const timestamp = Date.parse(value || "");
    if (!Number.isFinite(timestamp)) return "";
    return new Intl.DateTimeFormat(undefined, {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(timestamp));
  };

  const getStatusLabel = (status?: string) => {
    const normalized = (status || "").trim().toLowerCase();
    if (normalized === "completed") return t("sidebar.statusCompleted");
    if (normalized === "waiting_user") return t("sidebar.statusWaitingUser");
    return t("sidebar.statusInProgress");
  };

  return (
    <WorkspaceLayout fluid>
      <div className="mx-auto min-h-[calc(100vh-2rem)] w-full max-w-6xl px-4 py-4 sm:px-6">
        <div className="relative min-h-[calc(100vh-2rem)] pb-10">
          <motion.div
            initial={false}
            animate={
              showResultsStage
                ? { top: 56, y: 0 }
                : { top: "50%", y: "-50%" }
            }
            transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
            className="absolute inset-x-0 z-10 mx-auto w-full max-w-2xl will-change-transform"
          >
            <div className="relative rounded-[28px] bg-background/92 shadow-[0_24px_80px_rgba(15,23,42,0.08)] ring-1 ring-black/5 backdrop-blur-xl">
              <SearchIcon className="pointer-events-none absolute left-5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    setQuery("");
                    setResults([]);
                    setError("");
                  }
                }}
                placeholder={t("searchPage.placeholder")}
                className="h-16 border-0 bg-transparent pl-14 pr-14 text-base shadow-none focus-visible:ring-0"
              />
              {normalizedQuery ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute right-3 top-1/2 h-10 w-10 -translate-y-1/2 rounded-full text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                  onClick={() => {
                    setQuery("");
                    setResults([]);
                    setError("");
                    inputRef.current?.focus();
                  }}
                  aria-label={t("searchPage.clear")}
                >
                  <X className="h-4 w-4" />
                </Button>
              ) : null}
            </div>
          </motion.div>

          <AnimatePresence initial={false}>
            {showResultsStage ? (
              <motion.div
                key="search-results"
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 12 }}
                transition={{ duration: 0.24, ease: "easeOut" }}
                className="mx-auto w-full max-w-5xl pt-36"
              >
                {loading ? (
                  <div className="py-16 text-center text-sm text-muted-foreground">
                    {t("searchPage.loading")}
                  </div>
                ) : error ? (
                  <div className="py-16 text-center text-sm text-destructive">{error}</div>
                ) : results.length === 0 ? (
                  <div className="py-16 text-center text-sm text-muted-foreground">
                    {t("searchPage.empty")}
                  </div>
                ) : (
                  <div className="space-y-10">
                    {groupedResults.map((group) => (
                      <section key={group.key} className="space-y-2">
                        <div className="flex items-center justify-between gap-4 px-2">
                          <h2 className="truncate text-xs font-medium tracking-[0.22em] text-muted-foreground/90 uppercase">
                            {group.key === "__ungrouped__"
                              ? t("searchPage.ungrouped")
                              : group.label}
                          </h2>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {t("searchPage.groupCount", { count: group.items.length })}
                          </span>
                        </div>

                        <div className="divide-y divide-border/55">
                          {group.items.map((item, index) => (
                            <motion.button
                              key={`${group.key}:${item.sessionId}:${item.matchType || "message"}`}
                              type="button"
                              initial={{ opacity: 0, y: 10 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{
                                duration: 0.2,
                                delay: Math.min(index * 0.03, 0.18),
                                ease: "easeOut",
                              }}
                              className="flex w-full items-start gap-4 rounded-2xl px-2 py-4 text-left transition-colors hover:bg-muted/35"
                              onClick={() => {
                                setLocation(`/session/${encodeURIComponent(item.sessionId)}?view=history`);
                              }}
                            >
                              <div className="min-w-0 flex-1">
                                <div className="flex min-w-0 items-center gap-3">
                                  <span className="truncate text-sm font-medium text-foreground">
                                    {item.title}
                                  </span>
                                  <span className="shrink-0 text-[11px] text-muted-foreground">
                                    {item.matchType === "title"
                                      ? t("searchPage.titleMatch")
                                      : t("searchPage.messageMatch")}
                                  </span>
                                </div>
                                {item.snippet ? (
                                  <p className="mt-1 line-clamp-2 text-sm leading-6 text-muted-foreground">
                                    {item.snippet}
                                  </p>
                                ) : null}
                              </div>

                              <div className="flex shrink-0 items-center gap-3 pt-0.5 text-xs text-muted-foreground">
                                {item.updatedAt ? (
                                  <span className="inline-flex items-center gap-1 whitespace-nowrap">
                                    <Clock3 className="h-3.5 w-3.5" />
                                    {formatUpdatedAt(item.updatedAt)}
                                  </span>
                                ) : null}
                                <span>{getStatusLabel(item.status)}</span>
                                <ArrowUpRight className="h-4 w-4" />
                              </div>
                            </motion.button>
                          ))}
                        </div>
                      </section>
                    ))}
                  </div>
                )}
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </div>
    </WorkspaceLayout>
  );
}
