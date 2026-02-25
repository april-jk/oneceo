import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { OrchestrationRuntime } from "@/hooks/useTaskCreationAgent";
import { Loader2, RefreshCw, TerminalSquare } from "lucide-react";

function pickMessageText(message: OrchestrationRuntime["messages"][number]): string {
  const payload = (message?.payload || {}) as Record<string, unknown>;
  const candidates = [
    payload.output,
    payload.content,
    payload.message,
    payload.text,
    payload.error,
    payload.chunk,
    payload.status,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
    if (typeof candidate === "number" || typeof candidate === "boolean") {
      return String(candidate);
    }
  }

  return JSON.stringify(payload);
}

function pickTimestamp(message: OrchestrationRuntime["messages"][number]): string | null {
  const payload = (message?.payload || {}) as Record<string, unknown>;
  const candidates = [payload.at, payload.timestamp, payload.time, payload.createdAt];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return null;
}

function getTypeClass(type: string): string {
  if (type.includes("ERROR")) return "text-rose-700 bg-rose-50 border-rose-200";
  if (type.includes("STATUS")) return "text-amber-700 bg-amber-50 border-amber-200";
  if (type.includes("OUTPUT")) return "text-blue-700 bg-blue-50 border-blue-200";
  if (type.includes("LLM_PROXY")) return "text-emerald-700 bg-emerald-50 border-emerald-200";
  return "text-slate-700 bg-slate-50 border-slate-200";
}

interface TaskRuntimeDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  runtime: OrchestrationRuntime;
}

export default function TaskRuntimeDrawer({ open, onOpenChange, runtime }: TaskRuntimeDrawerProps) {
  const rows = [...runtime.messages]
    .filter((message) => !String(message.type || "").toUpperCase().includes("ERROR"))
    .reverse();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl">
        <SheetHeader className="border-b border-border pb-4">
          <SheetTitle className="flex items-center gap-2">
            <TerminalSquare className="h-4 w-4" />
            执行日志
          </SheetTitle>
          <SheetDescription>
            {runtime.orchestratorSessionId
              ? `编排会话：${runtime.orchestratorSessionId}`
              : "尚未建立执行环境会话"}
          </SheetDescription>
          <div className="flex items-center gap-2 pt-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={runtime.syncing || runtime.starting}
              onClick={() => {
                void runtime.refresh();
              }}
            >
              {runtime.syncing || runtime.starting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              {runtime.ready ? "刷新" : "加载日志"}
            </Button>
            <span className="text-xs text-muted-foreground">消息数：{runtime.messages.length}</span>
          </div>
        </SheetHeader>

        <ScrollArea className="h-[calc(100vh-180px)] px-4">
          {rows.length === 0 ? (
            <div className="py-8 text-sm text-muted-foreground">
              {runtime.ready ? "暂无执行日志。" : "执行日志尚未加载。"}
            </div>
          ) : (
            <div className="space-y-3 py-4">
              {rows.map((message, index) => {
                const type = String(message.type || "UNKNOWN");
                const requestId =
                  (message.requestId as string | undefined) ||
                  ((message.payload as Record<string, unknown> | undefined)?.requestId as string | undefined) ||
                  null;
                const text = pickMessageText(message);
                const timestamp = pickTimestamp(message);

                return (
                  <div key={`${type}-${requestId || "none"}-${index}`} className="rounded-lg border border-border p-3">
                    <div className="mb-2 flex items-center gap-2">
                      <span className={`rounded-full border px-2 py-0.5 text-xs ${getTypeClass(type)}`}>
                        {type}
                      </span>
                      {requestId && <span className="text-xs text-muted-foreground">requestId: {requestId}</span>}
                      {timestamp && <span className="ml-auto text-xs text-muted-foreground">{timestamp}</span>}
                    </div>
                    <pre className="whitespace-pre-wrap break-words rounded bg-muted/50 p-2 text-xs leading-5 text-foreground">
                      {text}
                    </pre>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
