import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Mic, Send, Sparkles } from "lucide-react";
import { useState } from "react";
import { useLocation } from "wouter";
import ConnectorDialog from "@/components/ConnectorDialog";
import AttachmentChipList from "@/components/AttachmentChipList";
import AttachmentPickerButton from "@/components/AttachmentPickerButton";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CreditBadge } from "@/components/CreditBadge";
import UserMenu from "@/components/UserMenu";
import type { TaskCreationPlatformSkill } from "@/lib/task-creation-client";
import {
  DEFAULT_ATTACHMENT_PROMPT,
  mergePendingAttachments,
  mergePendingPlatformSkills,
  stashPendingDraftAttachments,
  type PendingAttachment,
} from "@/lib/task-attachments";

function QuickActionRow({
  actions,
  direction,
  durationSeconds,
  onSelect,
}: {
  actions: readonly string[];
  direction: "left" | "right";
  durationSeconds: number;
  onSelect: (value: string) => void;
}) {
  const loopedActions = [...actions, ...actions, ...actions, ...actions];

  return (
    <div className="relative left-1/2 min-w-[280px] -translate-x-1/2 w-[min(calc(100%+30vw),calc(100vw-2rem))] sm:w-[min(calc(100%+30vw),calc(100vw-3rem))]">
      <div className="homepage-marquee-mask relative overflow-hidden">
        <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-12 bg-gradient-to-r from-background via-background/80 to-transparent sm:w-16" />
        <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-12 bg-gradient-to-l from-background via-background/80 to-transparent sm:w-16" />

        <div
          className="homepage-marquee-track py-1"
          data-direction={direction}
          style={{ animationDuration: `${durationSeconds}s` }}
        >
          {loopedActions.map((action, index) => (
            <Button
              key={`${action}-${index}`}
              variant="outline"
              className="h-11 shrink-0 rounded-xl border-border bg-background px-4 text-sm font-medium text-foreground shadow-sm transition-colors hover:border-foreground/15 hover:bg-accent"
              onClick={() => onSelect(action)}
            >
              {action}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function HomePage() {
  const [, setLocation] = useLocation();
  const { t } = useTranslation();
  const [message, setMessage] = useState("");
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [selectedModel, setSelectedModel] = useState<"lite" | "pro" | "max">("pro");
  const quickActionRows = t("homePage.quickActions", { returnObjects: true }) as string[][];

  const goToNewTask = (input: string) => {
    const value = input.trim() || (attachments.length ? DEFAULT_ATTACHMENT_PROMPT : "");
    if (!value) return;
    stashPendingDraftAttachments(attachments);
    setLocation(`/new-task?q=${encodeURIComponent(value)}`);
  };

  const handleAttachmentSelect = (files: File[]) => {
    const merged = mergePendingAttachments(attachments, files);
    setAttachments(merged.attachments);
    merged.rejected.forEach((item) => toast.error(item));
  };

  const handleSkillSelect = (skills: TaskCreationPlatformSkill[]) => {
    setAttachments((current) => mergePendingPlatformSkills(current, skills));
  };

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((item) => item.id !== id));
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <nav className="border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
        <div className="container mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/logo.png" alt="oneceo" className="w-9 h-9 rounded-lg" />
            <div className="flex flex-col">
              <span className="text-sm font-semibold text-foreground leading-tight">oneceo</span>
              <span className="text-xs text-muted-foreground leading-tight">{t("homePage.platformSubtitle")}</span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <CreditBadge />
            <UserMenu />
          </div>
        </div>
      </nav>

      <div className="flex-1 flex items-center justify-center p-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
          className="w-full max-w-3xl space-y-8"
        >
          <div className="text-center space-y-4">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.1, duration: 0.4 }}
              className="flex items-center justify-center gap-3"
            >
              <div className="w-12 h-12 bg-foreground rounded-2xl flex items-center justify-center shadow-lg">
                <span className="text-background font-bold text-xl">M</span>
              </div>
              <h1 className="text-3xl font-semibold text-foreground tracking-tight">{t("homePage.title")}</h1>
            </motion.div>
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.2, duration: 0.4 }}
              className="text-muted-foreground text-lg"
            >
              {t("homePage.subtitle")}
            </motion.p>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.4 }}
            className="bg-card border-2 border-border rounded-3xl shadow-lg hover:shadow-xl transition-all duration-200"
          >
            <div className="p-4 space-y-3">
              <Textarea
                placeholder={t("homePage.textareaPlaceholder")}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    goToNewTask(message);
                  }
                }}
                className="border-0 bg-transparent focus-visible:ring-0 text-base resize-none min-h-[100px] px-0 py-0"
                rows={4}
              />

              <AttachmentChipList attachments={attachments} onRemove={removeAttachment} />

              <TooltipProvider>
                <div className="flex items-center justify-between pt-2">
                  <div className="flex items-center gap-1">
                    <AttachmentPickerButton
                      onSelectFiles={handleAttachmentSelect}
                      onSelectSkills={handleSkillSelect}
                    />

                    <ConnectorDialog />

                    <DropdownMenu>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-9 px-3 rounded-xl gap-2 hover:bg-muted">
                              <Sparkles className="w-4 h-4 text-muted-foreground" />
                              <span className="text-sm text-muted-foreground">{t(`homePage.models.${selectedModel}`)}</span>
                            </Button>
                          </DropdownMenuTrigger>
                        </TooltipTrigger>
                        <TooltipContent><p>{t("homePage.selectModel")}</p></TooltipContent>
                      </Tooltip>
                      <DropdownMenuContent align="start" className="w-40">
                        <DropdownMenuItem onClick={() => setSelectedModel("lite")}>{t("homePage.models.lite")}</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setSelectedModel("pro")}>{t("homePage.models.pro")}</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setSelectedModel("max")}>{t("homePage.models.max")}</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  <div className="flex items-center gap-1">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-9 w-9 rounded-xl hover:bg-muted">
                          <Mic className="w-4 h-4 text-muted-foreground" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent><p>{t("homePage.voiceInput")}</p></TooltipContent>
                    </Tooltip>

                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          onClick={() => goToNewTask(message)}
                          disabled={!message.trim() && attachments.length === 0}
                          size="icon"
                          className="h-9 w-9 rounded-xl bg-foreground hover:bg-foreground/90 disabled:opacity-50"
                        >
                          <Send className="w-4 h-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent><p>{t("homePage.sendMessage")}</p></TooltipContent>
                    </Tooltip>
                  </div>
                </div>
              </TooltipProvider>
            </div>
          </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4, duration: 0.4 }}
          className="pt-3 space-y-3"
        >
            <QuickActionRow
              actions={quickActionRows[0] || []}
              direction="left"
              durationSeconds={28}
              onSelect={goToNewTask}
            />
            <QuickActionRow
              actions={quickActionRows[1] || []}
              direction="right"
              durationSeconds={32}
              onSelect={goToNewTask}
            />
            <QuickActionRow
              actions={quickActionRows[2] || []}
              direction="left"
              durationSeconds={36}
              onSelect={goToNewTask}
            />
          </motion.div>
        </motion.div>
      </div>
    </div>
  );
}
