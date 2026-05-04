import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useSearch } from "wouter";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { normalizeLanguage } from "@/i18n";
import {
  Bell,
  ChevronLeft,
  Copy,
  Diamond,
  KeyRound,
  LogOut,
  Mail,
  Pencil,
  Plug,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  UserRound,
  Wrench,
  X,
} from "lucide-react";
import { ConnectorCenterPanel } from "@/components/ConnectorCenterPanel";
import { UserSkillSettingsPanel } from "@/components/UserSkillSettingsPanel";
import { BillingSettingsPanel } from "@/components/BillingSettingsPanel";
import {
  ALTUS_MODE_STORAGE_KEY,
  DEFAULT_ALTUS_MODE,
  readAltusMode,
  type AltusMode,
} from "@/lib/altus-settings";
import { toast } from "sonner";
import {
  CLOSE_SETTINGS_DIALOG_EVENT,
  OPEN_SETTINGS_DIALOG_EVENT,
  type OpenSettingsDialogDetail,
  type SettingsTab,
} from "@/lib/settings-dialog-events";
import type { ConnectorKey } from "@/lib/connectors-client";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme, type ThemePreference } from "@/contexts/ThemeContext";
import type { AppUserPersonalization } from "@/lib/auth-client";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeTab: SettingsTab;
  onActiveTabChange: (tab: SettingsTab) => void;
  connectorTargetSessionId?: string | null;
  highlightedConnector?: ConnectorKey | null;
}

type SettingsPanelProps = {
  activeTab: SettingsTab;
  onActiveTabChange: (tab: SettingsTab) => void;
  onClose?: () => void;
  connectorTargetSessionId?: string | null;
  highlightedConnector?: ConnectorKey | null;
};

const SETTINGS_TABS: SettingsTab[] = [
  "personalization",
  "account",
  "model",
  "settings",
  "skills",
  "connectors",
  "billing",
];
const ACCOUNT_AVATAR_TONES = [
  "bg-emerald-500",
  "bg-sky-500",
  "bg-fuchsia-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-cyan-500",
];
const EMPTY_PERSONALIZATION: AppUserPersonalization = {
  preferredName: "",
  occupation: "",
  identity: "",
  location: "",
  background: "",
  preferences: "",
  responsePreferences: "",
};
const PERSONALIZATION_LIMITS: Record<keyof AppUserPersonalization, number> = {
  preferredName: 80,
  occupation: 80,
  identity: 80,
  location: 120,
  background: 1000,
  preferences: 800,
  responsePreferences: 1500,
};

function isSettingsTab(value: string | null | undefined): value is SettingsTab {
  return Boolean(value && SETTINGS_TABS.includes(value as SettingsTab));
}

function getAccountInitial(value: string | null | undefined) {
  const source = (value || "").trim();
  return (source.slice(0, 1) || "U").toUpperCase();
}

function getAccountAvatarTone(seed: string | null | undefined) {
  const value = (seed || "").trim();
  if (!value) {
    return ACCOUNT_AVATAR_TONES[0];
  }
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return ACCOUNT_AVATAR_TONES[hash % ACCOUNT_AVATAR_TONES.length];
}

function getReadableAccountStatus(
  status: string | undefined,
  fallback: string,
) {
  if (!status) {
    return fallback;
  }
  if (status === "active") {
    return fallback;
  }
  return status.replace(/[_-]/g, " ");
}

function normalizePersonalization(
  value: Partial<AppUserPersonalization> | null | undefined,
): AppUserPersonalization {
  return {
    preferredName: value?.preferredName?.trim?.() || "",
    occupation: value?.occupation?.trim?.() || "",
    identity: value?.identity?.trim?.() || "",
    location: value?.location?.trim?.() || "",
    background: value?.background?.trim?.() || "",
    preferences: value?.preferences?.trim?.() || "",
    responsePreferences: value?.responsePreferences?.trim?.() || "",
  };
}

function AppearancePreview({ theme }: { theme: ThemePreference }) {
  if (theme === "system") {
    return (
      <div className="flex h-full w-full overflow-hidden rounded-lg">
        <div className="flex min-w-0 flex-1 flex-col bg-white p-2">
          <div className="h-1.5 w-8 rounded-full bg-zinc-300" />
          <div className="mt-2 flex min-h-0 flex-1 gap-1.5">
            <div className="w-4 rounded-md bg-zinc-200" />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="h-2.5 rounded-md bg-zinc-100" />
              <div className="h-2.5 w-4/5 rounded-md bg-zinc-200" />
              <div className="h-2.5 w-3/5 rounded-md bg-zinc-200" />
            </div>
          </div>
        </div>
        <div className="flex min-w-0 flex-1 flex-col bg-zinc-900 p-2">
          <div className="h-1.5 w-8 rounded-full bg-zinc-600" />
          <div className="mt-2 flex min-h-0 flex-1 gap-1.5">
            <div className="w-4 rounded-md bg-zinc-800" />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="h-2.5 rounded-md bg-zinc-800" />
              <div className="h-2.5 w-4/5 rounded-md bg-zinc-700" />
              <div className="h-2.5 w-3/5 rounded-md bg-blue-500/70" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (theme === "dark-gold") {
    return (
      <div className="flex h-full w-full flex-col bg-[#120F0A] p-2">
        <div className="h-1.5 w-8 rounded-full bg-[#C8A24C]" />
        <div className="mt-2 flex min-h-0 flex-1 gap-1.5">
          <div className="w-4 rounded-md bg-[#241D14]" />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="h-2.5 rounded-md bg-[#1D1811]" />
            <div className="h-2.5 w-4/5 rounded-md bg-[#2A2218]" />
            <div className="h-2.5 w-3/5 rounded-md bg-[#C8A24C]" />
          </div>
        </div>
      </div>
    );
  }

  const isDark = theme === "dark";

  return (
    <div
      className={cn(
        "flex h-full w-full flex-col p-2 transition-colors",
        isDark ? "bg-zinc-900" : "bg-white",
      )}
    >
      <div
        className={cn(
          "h-1.5 w-8 rounded-full",
          isDark ? "bg-zinc-600" : "bg-zinc-300",
        )}
      />
      <div className="mt-2 flex min-h-0 flex-1 gap-1.5">
        <div
          className={cn(
            "w-4 rounded-md",
            isDark ? "bg-zinc-800" : "bg-zinc-200",
          )}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div
            className={cn(
              "h-2.5 rounded-md",
              isDark ? "bg-zinc-800" : "bg-zinc-100",
            )}
          />
          <div
            className={cn(
              "h-2.5 w-4/5 rounded-md",
              isDark ? "bg-zinc-700" : "bg-zinc-200",
            )}
          />
          <div
            className={cn(
              "h-2.5 w-3/5 rounded-md",
              isDark ? "bg-[var(--brand-soft-foreground)]" : "bg-zinc-300",
            )}
          />
        </div>
      </div>
    </div>
  );
}

function SettingsSection({
  eyebrow,
  title,
  description,
  children,
  className,
  contentClassName,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
  actions?: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        "rounded-[20px] border border-border/70 bg-background shadow-sm",
        className,
      )}
    >
      <div className="flex flex-col gap-3 border-b border-border/60 px-5 py-4 md:flex-row md:items-start md:justify-between md:px-6">
        <div className="min-w-0">
          {eyebrow ? (
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/80">
              {eyebrow}
            </div>
          ) : null}
          <h3 className="mt-1 text-[17px] font-semibold tracking-[-0.01em] text-foreground">
            {title}
          </h3>
          {description ? (
            <p className="mt-1 max-w-[62ch] text-sm leading-6 text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
      <div className={cn("px-5 py-5 md:px-6", contentClassName)}>{children}</div>
    </section>
  );
}

function CounterText({
  current,
  limit,
}: {
  current: number;
  limit: number;
}) {
  return (
    <div className="text-right text-[11px] font-medium tabular-nums text-muted-foreground">
      {current} / {limit}
    </div>
  );
}

export function SettingsPanel({
  activeTab,
  onActiveTabChange,
  onClose,
  connectorTargetSessionId,
  highlightedConnector,
}: SettingsPanelProps) {
  const { t, i18n } = useTranslation();
  const [, setLocation] = useLocation();
  const { user, logout, updateProfile, uploadAvatar, removeAvatar } = useAuth();
  const { theme, setTheme } = useTheme();
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [pushNotifications, setPushNotifications] = useState(true);
  const [executor, setExecutor] = useState("opencode");
  const [codexExecutionMode, setCodexExecutionMode] = useState("sdk");
  const [accountDisplayNameDraft, setAccountDisplayNameDraft] = useState("");
  const [accountSaving, setAccountSaving] = useState(false);
  const [avatarSaving, setAvatarSaving] = useState(false);
  const [personalizationDraft, setPersonalizationDraft] =
    useState<AppUserPersonalization>(EMPTY_PERSONALIZATION);
  const [personalizationSaving, setPersonalizationSaving] = useState(false);
  const [accountView, setAccountView] = useState<"overview" | "details">(
    "overview",
  );
  // Altus 控制模式：
  // - sandbox: 直通模式，前端输入直接转发到 sandbox 内执行器（当前为 OpenCode）。
  // - managed: Altus 接管模式，走三层智能体编排。
  // 预留后续直通模式扩展，保持此枚举语义稳定。
  const [altusMode, setAltusMode] = useState<AltusMode>(DEFAULT_ALTUS_MODE);
  const accountNameInputRef = useRef<HTMLInputElement | null>(null);
  const accountAvatarInputRef = useRef<HTMLInputElement | null>(null);
  const EXECUTOR_STORAGE_KEY = "altus_executor";
  const CODEX_EXECUTION_MODE_STORAGE_KEY = "codex_execution_mode";

  useEffect(() => {
    if (typeof window === "undefined") return;
    const storedExecutor = window.localStorage.getItem(EXECUTOR_STORAGE_KEY);
    const storedCodexExecutionMode = window.localStorage.getItem(
      CODEX_EXECUTION_MODE_STORAGE_KEY,
    );
    if (storedExecutor) {
      setExecutor(storedExecutor);
    } else {
      window.localStorage.setItem(EXECUTOR_STORAGE_KEY, executor);
    }
    setAltusMode(readAltusMode());
    if (
      storedCodexExecutionMode === "sdk" ||
      storedCodexExecutionMode === "ws"
    ) {
      setCodexExecutionMode(storedCodexExecutionMode);
    } else {
      window.localStorage.setItem(
        CODEX_EXECUTION_MODE_STORAGE_KEY,
        codexExecutionMode,
      );
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(EXECUTOR_STORAGE_KEY, executor);
    window.localStorage.setItem(ALTUS_MODE_STORAGE_KEY, altusMode);
    window.localStorage.setItem(
      CODEX_EXECUTION_MODE_STORAGE_KEY,
      codexExecutionMode,
    );
    window.dispatchEvent(
      new CustomEvent("altus-settings-changed", {
        detail: { executor, altusMode, codexExecutionMode },
      }),
    );
  }, [executor, altusMode, codexExecutionMode]);

  const shouldShowExecutorSettings = altusMode === "sandbox";
  const accountInitial = getAccountInitial(user?.displayName || user?.email);
  const accountAvatarTone = getAccountAvatarTone(
    user?.email || user?.displayName,
  );
  const accountStatusText = getReadableAccountStatus(
    user?.status,
    t("account.statusActive"),
  );
  const currentLanguage = normalizeLanguage(
    i18n.resolvedLanguage || i18n.language,
  );
  const accountDisplayNameChanged =
    accountDisplayNameDraft.trim() !== (user?.displayName || "").trim();
  const accountDisplayNameValid = Boolean(accountDisplayNameDraft.trim());
  const accountAvatarUrl = user?.avatarUrl || undefined;
  const personalizationBaseline = useMemo(
    () => normalizePersonalization(user?.personalization),
    [user?.personalization],
  );
  const personalizationDirty = useMemo(
    () =>
      (
        Object.keys(EMPTY_PERSONALIZATION) as Array<keyof AppUserPersonalization>
      ).some(
        (key) => personalizationDraft[key] !== personalizationBaseline[key],
      ),
    [personalizationBaseline, personalizationDraft],
  );
  const appearanceOptions = useMemo(
    () =>
      [
        { value: "light", label: t("settings.light") },
        { value: "dark", label: t("settings.dark") },
        { value: "dark-gold", label: t("settings.darkGold") },
        { value: "system", label: t("settings.system") },
      ] as Array<{ value: ThemePreference; label: string }>,
    [i18n.resolvedLanguage, t],
  );
  const primaryInputClassName =
    "h-11 rounded-xl border-border/70 bg-background/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)]";
  const primaryTextareaClassName =
    "rounded-xl border-border/70 bg-background/80 leading-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)]";
  const navItems = [
    {
      value: "personalization" as const,
      label: t("settings.personalizationTab"),
      icon: Pencil,
    },
    {
      value: "account" as const,
      label: t("settings.accountTab"),
      icon: UserRound,
    },
    {
      value: "model" as const,
      label: t("settings.modelTab"),
      icon: SlidersHorizontal,
    },
    {
      value: "settings" as const,
      label: t("settings.settingsTab"),
      icon: Settings2,
    },
    {
      value: "skills" as const,
      label: t("settings.skillsTab"),
      icon: Wrench,
    },
    {
      value: "connectors" as const,
      label: t("settings.connectorsTab"),
      icon: Plug,
    },
    {
      value: "billing" as const,
      label: "积分与消费",
      icon: Diamond,
    },
  ];

  const handleLanguageChange = (lang: string) => {
    void i18n.changeLanguage(normalizeLanguage(lang));
  };

  useEffect(() => {
    setAccountDisplayNameDraft(user?.displayName || "");
  }, [user?.displayName]);

  useEffect(() => {
    setPersonalizationDraft(personalizationBaseline);
  }, [personalizationBaseline]);

  useEffect(() => {
    if (activeTab !== "account") {
      setAccountView("overview");
    }
  }, [activeTab]);

  const handleCopyUserId = async () => {
    if (!user?.id) return;
    try {
      await navigator.clipboard.writeText(user.id);
      toast.success(t("account.userIdCopied"));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("account.userIdCopyFailed"),
      );
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
      toast.success(t("account.logoutSuccess"));
      setLocation("/login");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("account.logoutFailed"),
      );
    }
  };

  const handleUnavailableAction = (message: string) => {
    toast.error(message);
  };

  const handleOpenAccountDetails = () => {
    setAccountView("details");
    if (typeof window !== "undefined") {
      window.setTimeout(() => {
        accountNameInputRef.current?.focus();
      }, 0);
    }
  };

  const handlePersonalizationFieldChange = (
    field: keyof AppUserPersonalization,
    value: string,
  ) => {
    setPersonalizationDraft((current) => ({
      ...current,
      [field]: value.slice(0, PERSONALIZATION_LIMITS[field]),
    }));
  };

  const handleResetPersonalization = () => {
    setPersonalizationDraft(personalizationBaseline);
  };

  const handleSavePersonalization = async () => {
    try {
      setPersonalizationSaving(true);
      await updateProfile({
        personalization: personalizationDraft,
      });
      toast.success(t("settings.personalizationSaved"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("settings.personalizationSaveFailed"),
      );
    } finally {
      setPersonalizationSaving(false);
    }
  };

  const handleSaveAccountDisplayName = async () => {
    try {
      setAccountSaving(true);
      await updateProfile({
        displayName: accountDisplayNameDraft.trim(),
      });
      toast.success(t("account.profileUpdated"));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("account.profileUpdateFailed"),
      );
    } finally {
      setAccountSaving(false);
    }
  };

  const handleAvatarFileChange = async (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      toast.error(t("account.avatarFormatInvalid"));
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error(t("account.avatarSizeExceeded"));
      return;
    }
    try {
      setAvatarSaving(true);
      await uploadAvatar(file);
      toast.success(t("account.avatarUploadSuccess"));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("account.avatarUploadFailed"),
      );
    } finally {
      setAvatarSaving(false);
    }
  };

  const handleRemoveAvatar = async () => {
    try {
      setAvatarSaving(true);
      await removeAvatar();
      toast.success(t("account.avatarRemoveSuccess"));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("account.avatarRemoveFailed"),
      );
    } finally {
      setAvatarSaving(false);
    }
  };

  const handleOpenAvatarPicker = () => {
    accountAvatarInputRef.current?.click();
  };

  return (
    <div className="h-full bg-background">
      <Tabs
        value={activeTab}
        onValueChange={(value) => onActiveTabChange(value as SettingsTab)}
        className="h-full"
      >
        <div className="flex h-full flex-col md:flex-row">
          <aside className="shrink-0 border-b border-border/70 bg-background md:min-w-[236px] md:max-w-[236px] md:border-b-0 md:border-r md:m-4 md:mr-0 md:rounded-l-[22px]">
            <div className="flex min-h-0 flex-1 flex-col px-4 pb-4 pt-4 md:px-3 md:pb-5 md:pt-5">
              <TabsList className="flex h-full w-full flex-shrink-0 items-start justify-start gap-3 self-stretch overflow-x-auto bg-transparent px-0 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden md:flex-col md:overflow-x-visible md:overflow-y-auto">
                <div className="flex items-start gap-3 self-stretch md:flex-col md:gap-1.5">
                  {navItems.map((item) => {
                    const Icon = item.icon;
                    return (
                      <TabsTrigger
                        key={item.value}
                        value={item.value}
                        className="group flex items-center gap-2.5 border border-transparent px-2 py-2.5 text-[14px] leading-5 text-foreground max-md:whitespace-nowrap md:h-11 md:self-stretch md:justify-start md:rounded-xl md:px-3.5 md:hover:border-border/80 md:hover:bg-background/80 md:data-[state=active]:bg-background md:data-[state=active]:shadow-sm max-md:border-b-2 max-md:border-transparent max-md:data-[state=active]:border-foreground"
                      >
                        <span className="hidden rounded-lg border border-transparent p-1.5 text-muted-foreground transition-colors md:flex md:group-data-[state=active]:bg-muted md:group-data-[state=active]:text-foreground">
                          <Icon className="h-4 w-4" />
                        </span>
                        <span className="truncate font-medium">{item.label}</span>
                      </TabsTrigger>
                    );
                  })}
                </div>
              </TabsList>
            </div>
          </aside>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background md:m-4 md:ml-0 md:rounded-r-[22px] md:border md:border-border/60">
            <div className="h-full flex-1 overflow-y-auto px-4 py-4 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden md:px-6 md:py-6">
              <TabsContent value="personalization" className="mt-0">
                <div className="mx-auto flex w-full max-w-[720px] flex-col gap-6 pb-6">
                  <SettingsSection
                    eyebrow="Prompt memory"
                    title={t("settings.personalizationTitle")}
                    description={t("settings.personalizationDescription")}
                    actions={
                      <div className="rounded-full border border-border/70 bg-muted/50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                        User profile context
                      </div>
                    }
                    contentClassName="space-y-5"
                  >
                    <div className="grid gap-3 rounded-2xl border border-border/60 bg-muted/20 p-4 md:grid-cols-3">
                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/75">
                          Identity
                        </div>
                        <div className="mt-2 text-sm leading-6 text-foreground">
                          {personalizationDraft.preferredName ||
                            t("settings.preferredNamePlaceholder")}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/75">
                          Role
                        </div>
                        <div className="mt-2 text-sm leading-6 text-foreground">
                          {personalizationDraft.occupation ||
                            t("settings.occupationPlaceholder")}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/75">
                          Locale
                        </div>
                        <div className="mt-2 text-sm leading-6 text-foreground">
                          {personalizationDraft.location ||
                            t("settings.locationPlaceholder")}
                        </div>
                      </div>
                    </div>
                  </SettingsSection>

                  <SettingsSection
                    eyebrow="Identity"
                    title={t("settings.identitySectionTitle")}
                    description={t("settings.identitySectionDescription")}
                  >
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="personalization-preferred-name">
                          {t("settings.preferredNameLabel")}
                        </Label>
                        <Input
                          id="personalization-preferred-name"
                          value={personalizationDraft.preferredName}
                          onChange={(event) =>
                            handlePersonalizationFieldChange(
                              "preferredName",
                              event.target.value,
                            )
                          }
                          maxLength={PERSONALIZATION_LIMITS.preferredName}
                          placeholder={t("settings.preferredNamePlaceholder")}
                          className={primaryInputClassName}
                        />
                        <CounterText
                          current={personalizationDraft.preferredName.length}
                          limit={PERSONALIZATION_LIMITS.preferredName}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="personalization-occupation">
                          {t("settings.occupationLabel")}
                        </Label>
                        <Input
                          id="personalization-occupation"
                          value={personalizationDraft.occupation}
                          onChange={(event) =>
                            handlePersonalizationFieldChange(
                              "occupation",
                              event.target.value,
                            )
                          }
                          maxLength={PERSONALIZATION_LIMITS.occupation}
                          placeholder={t("settings.occupationPlaceholder")}
                          className={primaryInputClassName}
                        />
                        <CounterText
                          current={personalizationDraft.occupation.length}
                          limit={PERSONALIZATION_LIMITS.occupation}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="personalization-identity">
                          {t("settings.identityLabel")}
                        </Label>
                        <Input
                          id="personalization-identity"
                          value={personalizationDraft.identity}
                          onChange={(event) =>
                            handlePersonalizationFieldChange(
                              "identity",
                              event.target.value,
                            )
                          }
                          maxLength={PERSONALIZATION_LIMITS.identity}
                          placeholder={t("settings.identityPlaceholder")}
                          className={primaryInputClassName}
                        />
                        <CounterText
                          current={personalizationDraft.identity.length}
                          limit={PERSONALIZATION_LIMITS.identity}
                        />
                      </div>
                      <div className="space-y-2 md:col-span-2">
                        <Label htmlFor="personalization-location">
                          {t("settings.locationLabel")}
                        </Label>
                        <Input
                          id="personalization-location"
                          value={personalizationDraft.location}
                          onChange={(event) =>
                            handlePersonalizationFieldChange(
                              "location",
                              event.target.value,
                            )
                          }
                          maxLength={PERSONALIZATION_LIMITS.location}
                          placeholder={t("settings.locationPlaceholder")}
                          className={primaryInputClassName}
                        />
                        <CounterText
                          current={personalizationDraft.location.length}
                          limit={PERSONALIZATION_LIMITS.location}
                        />
                      </div>
                    </div>
                  </SettingsSection>

                  <SettingsSection
                    eyebrow="Background"
                    title={t("settings.aboutSectionTitle")}
                    description={t("settings.aboutSectionDescription")}
                  >
                    <div className="space-y-2">
                      <Label htmlFor="personalization-background">
                        {t("settings.backgroundLabel")}
                      </Label>
                      <Textarea
                        id="personalization-background"
                        value={personalizationDraft.background}
                        onChange={(event) =>
                          handlePersonalizationFieldChange(
                            "background",
                            event.target.value,
                          )
                        }
                        maxLength={PERSONALIZATION_LIMITS.background}
                        rows={6}
                        placeholder={t("settings.backgroundPlaceholder")}
                        className={cn("min-h-[160px]", primaryTextareaClassName)}
                      />
                      <CounterText
                        current={personalizationDraft.background.length}
                        limit={PERSONALIZATION_LIMITS.background}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="personalization-preferences">
                        {t("settings.preferencesLabel")}
                      </Label>
                      <Textarea
                        id="personalization-preferences"
                        value={personalizationDraft.preferences}
                        onChange={(event) =>
                          handlePersonalizationFieldChange(
                            "preferences",
                            event.target.value,
                          )
                        }
                        maxLength={PERSONALIZATION_LIMITS.preferences}
                        rows={5}
                        placeholder={t("settings.preferencesPlaceholder")}
                        className={cn("min-h-[132px]", primaryTextareaClassName)}
                      />
                      <CounterText
                        current={personalizationDraft.preferences.length}
                        limit={PERSONALIZATION_LIMITS.preferences}
                      />
                    </div>
                  </SettingsSection>

                  <SettingsSection
                    eyebrow="Execution hints"
                    title={t("settings.instructionsSectionTitle")}
                    description={t("settings.instructionsSectionDescription")}
                    actions={
                      <div className="hidden rounded-full border border-border/70 bg-background/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground md:block">
                        Feeds future task creation
                      </div>
                    }
                  >
                    <div className="space-y-2">
                      <Label htmlFor="personalization-response-preferences">
                        {t("settings.responsePreferencesLabel")}
                      </Label>
                      <Textarea
                        id="personalization-response-preferences"
                        value={personalizationDraft.responsePreferences}
                        onChange={(event) =>
                          handlePersonalizationFieldChange(
                            "responsePreferences",
                            event.target.value,
                          )
                        }
                        maxLength={PERSONALIZATION_LIMITS.responsePreferences}
                        rows={7}
                        placeholder={t(
                          "settings.responsePreferencesPlaceholder",
                        )}
                        className={cn("min-h-[180px]", primaryTextareaClassName)}
                      />
                      <CounterText
                        current={personalizationDraft.responsePreferences.length}
                        limit={PERSONALIZATION_LIMITS.responsePreferences}
                      />
                    </div>
                  </SettingsSection>

                  <div className="flex items-center justify-end gap-3 border-t border-border/70 px-1 pt-5">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleResetPersonalization}
                      disabled={!personalizationDirty || personalizationSaving}
                      className="h-10 rounded-lg px-4"
                    >
                      {t("settings.resetAction")}
                    </Button>
                    <Button
                      type="button"
                      onClick={() => void handleSavePersonalization()}
                      disabled={!personalizationDirty || personalizationSaving}
                      className="h-10 rounded-lg bg-foreground px-4 text-background hover:bg-foreground/90"
                    >
                      {personalizationSaving
                        ? t("common.loading")
                        : t("common.save")}
                    </Button>
                  </div>
                </div>
              </TabsContent>

              {/* Settings Tab */}
              <TabsContent value="settings" className="mt-0">
                <div className="mx-auto flex w-full max-w-[720px] flex-col gap-6 pb-6">
                  <SettingsSection
                    eyebrow="Environment"
                    title={t("settings.languageLabel")}
                    description={t("settings.languageDescription")}
                  >
                  <Select
                    value={currentLanguage}
                    onValueChange={handleLanguageChange}
                  >
                    <SelectTrigger className="w-full max-w-xs rounded-xl border-border/70 bg-background/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl">
                      <SelectItem value="zh" className="rounded-md">
                        {t("settings.chinese")}
                      </SelectItem>
                      <SelectItem value="en" className="rounded-md">
                        {t("settings.english")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  </SettingsSection>

                  <SettingsSection
                    eyebrow="Theme"
                    title={t("settings.appearanceLabel")}
                    description={t("settings.appearanceDescription")}
                  >
                  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                    {appearanceOptions.map((option) => {
                      const selected = theme === option.value;

                      return (
                        <button
                          key={option.value}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => setTheme(option.value)}
                          className="flex flex-col items-start gap-3 rounded-2xl border border-border/70 bg-background p-3 text-left text-[13px] transition-[border-color,box-shadow] hover:border-border hover:bg-muted/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        >
                          <span
                            className={cn(
                              "block h-[80px] w-full overflow-hidden rounded-xl border bg-card text-left transition-colors",
                              selected
                                ? "border-2 border-primary shadow-sm"
                                : "border-border hover:border-primary/60",
                            )}
                          >
                            <AppearancePreview theme={option.value} />
                          </span>
                          <span className="flex w-full items-center justify-between gap-3">
                            <span
                              className={cn(
                                "transition-colors",
                                selected
                                  ? "text-foreground"
                                  : "text-muted-foreground",
                              )}
                            >
                              {option.label}
                            </span>
                            {selected ? (
                              <span className="rounded-full border border-border/70 bg-muted/50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-foreground">
                                Active
                              </span>
                            ) : null}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  </SettingsSection>

                  <SettingsSection
                    eyebrow="Signals"
                    title={t("settings.notificationsLabel")}
                    description={t("settings.notificationsDescription")}
                  >
                  <div className="divide-y divide-border/60 overflow-hidden rounded-2xl border border-border/60 bg-muted/20">
                    <div className="flex items-center justify-between px-4 py-4">
                      <div className="flex items-center gap-3">
                        <Mail className="h-4 w-4 text-muted-foreground" />
                        <Label htmlFor="email-notifications" className="text-sm">
                          {t("settings.emailNotifications")}
                        </Label>
                      </div>
                      <Switch
                        id="email-notifications"
                        checked={emailNotifications}
                        onCheckedChange={setEmailNotifications}
                      />
                    </div>
                    <div className="flex items-center justify-between px-4 py-4">
                      <div className="flex items-center gap-3">
                        <Bell className="h-4 w-4 text-muted-foreground" />
                        <Label htmlFor="push-notifications" className="text-sm">
                          {t("settings.pushNotifications")}
                        </Label>
                      </div>
                      <Switch
                        id="push-notifications"
                        checked={pushNotifications}
                        onCheckedChange={setPushNotifications}
                      />
                    </div>
                  </div>
                  </SettingsSection>
                </div>
              </TabsContent>

              {/* Model Tab */}
              <TabsContent value="model" className="mt-0">
                <div className="mx-auto flex w-full max-w-[720px] flex-col gap-6 pb-6">
                <SettingsSection
                  eyebrow="Runtime"
                  title={t("settings.altusControlLabel")}
                  description={t("settings.altusControlDescription")}
                >
                  <Select
                    value={altusMode}
                    onValueChange={(value) => setAltusMode(value as AltusMode)}
                  >
                    <SelectTrigger className="w-full max-w-xs rounded-xl border-border/70 bg-background/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl">
                      <SelectItem value="sandbox" className="rounded-md">
                        {t("settings.altusSandboxDirect")}
                      </SelectItem>
                      <SelectItem value="managed" className="rounded-md">
                        {t("settings.altusManaged")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </SettingsSection>

                {shouldShowExecutorSettings ? (
                  <SettingsSection
                    eyebrow="Executor"
                    title={t("settings.executorLabel")}
                    description={t("settings.executorDescription")}
                  >
                    <Select value={executor} onValueChange={setExecutor}>
                      <SelectTrigger className="w-full max-w-xs rounded-xl border-border/70 bg-background/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="rounded-xl">
                        <SelectItem value="opencode" className="rounded-md">
                          {t("settings.executorOpencode")}
                        </SelectItem>
                        <SelectItem value="codex" className="rounded-md">
                          {t("settings.executorCodex")}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </SettingsSection>
                ) : null}

                {executor === "codex" && altusMode === "sandbox" ? (
                  <SettingsSection
                    eyebrow="Codex"
                    title={t("settings.codexModeLabel")}
                    description={t("settings.codexModeDescription")}
                    className="bg-muted/20"
                  >
                    <Select
                      value={codexExecutionMode}
                      onValueChange={setCodexExecutionMode}
                    >
                      <SelectTrigger className="w-full max-w-xs rounded-xl border-border/70 bg-background/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="rounded-xl">
                        <SelectItem value="sdk" className="rounded-md">
                          {t("settings.codexModeSdk")}
                        </SelectItem>
                        <SelectItem value="ws" className="rounded-md">
                          {t("settings.codexModeWs")}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </SettingsSection>
                ) : null}
                </div>
              </TabsContent>

              {/* Account Tab */}
              <TabsContent value="account" className="mt-0 h-full">
                <div className="flex min-h-full flex-col">
                  <div className="flex min-h-full w-full flex-1 flex-col md:mx-auto md:max-w-[720px]">
                    <div className="flex flex-1 flex-col items-start self-stretch pb-4 pt-2 md:pt-2">
                      {accountView === "overview" ? (
                        <div className="flex w-full flex-col gap-5">
                          <div className="rounded-[20px] border border-border/70 bg-background p-5 shadow-sm md:p-6">
                          <div className="flex flex-col justify-between gap-4 border-b border-border/60 pb-6 md:flex-row md:items-center">
                            <div className="flex min-w-0 flex-1 items-center gap-4">
                              <Avatar className="h-16 w-16 border border-border/70 shadow-[0_8px_20px_rgba(15,23,42,0.08)]">
                                <AvatarImage
                                  src={accountAvatarUrl}
                                  alt={
                                    user?.displayName ||
                                    user?.email ||
                                    t("account.title")
                                  }
                                />
                                <AvatarFallback
                                  className={cn(
                                    "text-[32px] font-bold text-white",
                                    accountAvatarTone,
                                  )}
                                >
                                  {accountInitial}
                                </AvatarFallback>
                              </Avatar>
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-[22px] font-semibold leading-[28px] text-foreground">
                                  {user?.displayName ||
                                    user?.email ||
                                    t("account.unknownUser")}
                                </div>
                                <div className="truncate pt-1 text-sm leading-6 text-muted-foreground">
                                  {user?.email || t("account.noEmail")}
                                </div>
                              </div>
                            </div>

                            <div className="flex gap-2 self-start md:self-center">
                              <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                onClick={handleOpenAccountDetails}
                                className="h-9 w-9 rounded-lg border-border bg-background shadow-none"
                                aria-label={t("account.editProfile")}
                              >
                                <Pencil className="h-4 w-4 text-muted-foreground" />
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                onClick={() => void handleLogout()}
                                className="h-9 w-9 rounded-lg border-border bg-background text-destructive shadow-none"
                                aria-label={t("account.logout")}
                              >
                                <LogOut className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>

                          <div className="mt-5 rounded-2xl border border-border/60 bg-muted/20 px-4 md:px-5">
                            <div className="flex flex-col gap-3 border-b border-border/70 py-4 sm:flex-row sm:items-center sm:justify-between">
                              <div className="flex flex-col gap-1">
                                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/75">
                                  Plan
                                </div>
                                <div className="text-base font-semibold leading-6 text-foreground">
                                  {t("account.planFree")}
                                </div>
                                <div className="text-sm text-muted-foreground">
                                  {t("account.planDescription")}
                                </div>
                              </div>
                              <Button
                                type="button"
                                variant="outline"
                                onClick={() =>
                                  handleUnavailableAction(
                                    t("account.upgradeUnavailable"),
                                  )
                                }
                                className="h-8 rounded-lg border-foreground bg-foreground px-3 text-sm text-background hover:bg-foreground/90 hover:text-background"
                              >
                                {t("account.upgrade")}
                              </Button>
                            </div>

                            <div className="grid gap-4 py-4 sm:grid-cols-3">
                              <div className="rounded-xl border border-border/60 bg-muted/15 p-4">
                                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                                  <ShieldCheck className="h-4 w-4 text-muted-foreground" />
                                  <span>{t("account.accountStatus")}</span>
                                </div>
                                <div className="mt-2 text-sm text-muted-foreground">
                                  {accountStatusText}
                                </div>
                              </div>
                              <div className="rounded-xl border border-border/60 bg-muted/15 p-4">
                                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                                  <Mail className="h-4 w-4 text-muted-foreground" />
                                  <span>{t("account.authMethod")}</span>
                                </div>
                                <div className="mt-2 text-sm text-muted-foreground">
                                  {t("account.authMethodEmail")}
                                </div>
                              </div>
                              <div className="rounded-xl border border-border/60 bg-muted/15 p-4">
                                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                                  <ShieldCheck className="h-4 w-4 text-muted-foreground" />
                                  <span>{t("account.sessionIsolation")}</span>
                                </div>
                                <div className="mt-2 text-sm text-muted-foreground">
                                  {t("account.sessionIsolationEnabled")}
                                </div>
                              </div>
                            </div>
                          </div>
                          </div>
                        </div>
                      ) : (
                        <div className="flex w-full flex-col gap-5 rounded-[20px] border border-border/70 bg-background p-5 shadow-sm md:p-6">
                          <div className="flex items-center gap-3 border-b border-border/60 pb-5">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => setAccountView("overview")}
                              className="h-8 w-8 rounded-md"
                              aria-label={t("account.backToOverview")}
                            >
                              <ChevronLeft className="h-4 w-4" />
                            </Button>
                            <div>
                              <div className="text-lg font-semibold leading-6 text-foreground">
                                {t("account.detailsTitle")}
                              </div>
                              <div className="text-sm text-muted-foreground">
                                {t("account.detailsDescription")}
                              </div>
                            </div>
                          </div>

                          <div className="flex flex-col">
                            <div className="flex flex-col gap-6 border-b border-border/60 py-4 sm:flex-row sm:items-center">
                              <div className="group relative h-20 w-20 overflow-hidden rounded-full border border-border/70">
                                <Avatar className="h-20 w-20 rounded-full">
                                <AvatarImage
                                    src={accountAvatarUrl}
                                    alt={
                                      user?.displayName ||
                                      user?.email ||
                                      t("account.title")
                                    }
                                  />
                                  <AvatarFallback
                                    className={cn(
                                      "text-[40px] font-bold text-white",
                                      accountAvatarTone,
                                    )}
                                  >
                                    {accountInitial}
                                  </AvatarFallback>
                                </Avatar>
                                <button
                                  type="button"
                                  onClick={handleOpenAvatarPicker}
                                  disabled={avatarSaving}
                                  className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100"
                                  aria-label={t("account.editAvatar")}
                                >
                                  <Pencil className="h-5 w-5 text-white" />
                                </button>
                                <input
                                  ref={accountAvatarInputRef}
                                  type="file"
                                  accept="image/jpeg,image/png,image/webp"
                                  className="hidden"
                                  onChange={(event) =>
                                    void handleAvatarFileChange(event)
                                  }
                                />
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                <Button
                                  type="button"
                                  variant="outline"
                                  onClick={handleOpenAvatarPicker}
                                  disabled={avatarSaving}
                                  className="h-8 rounded-lg px-3 text-sm"
                                >
                                  {avatarSaving
                                    ? t("common.loading")
                                    : t("account.changeAvatar")}
                                </Button>
                                <Button
                                  type="button"
                                  variant="outline"
                                  onClick={() => void handleRemoveAvatar()}
                                  disabled={avatarSaving || !user?.avatarUrl}
                                  className="h-8 rounded-lg px-3 text-sm"
                                >
                                  {avatarSaving
                                    ? t("common.loading")
                                    : t("account.removeAvatar")}
                                </Button>
                              </div>

                              <div className="flex min-w-0 flex-1 flex-col gap-2">
                                <span className="text-sm leading-6 text-muted-foreground">
                                  {t("account.usernameLabel")}
                                </span>
                                <div className="flex flex-col gap-3 md:flex-row md:items-center">
                                  <div className="group flex h-11 flex-1 items-center gap-3 rounded-xl border border-border/70 bg-background/80 px-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)]">
                                    <input
                                      ref={accountNameInputRef}
                                      maxLength={20}
                                      value={accountDisplayNameDraft}
                                      onChange={(event) =>
                                        setAccountDisplayNameDraft(
                                          event.target.value,
                                        )
                                      }
                                      className="h-full min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/70"
                                      placeholder={t(
                                        "account.usernamePlaceholder",
                                      )}
                                    />
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setAccountDisplayNameDraft("")
                                      }
                                      className="text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100 focus:opacity-100"
                                      aria-label={t("account.clearDisplayName")}
                                    >
                                      <X className="h-4 w-4" />
                                    </button>
                                  </div>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() =>
                                      void handleSaveAccountDisplayName()
                                    }
                                    disabled={
                                      !accountDisplayNameChanged ||
                                      !accountDisplayNameValid ||
                                      accountSaving
                                    }
                                    className="h-10 rounded-lg px-4"
                                  >
                                    {accountSaving
                                      ? t("common.loading")
                                      : t("account.updateProfile")}
                                  </Button>
                                </div>
                                <p className="text-xs leading-5 text-muted-foreground">
                                  {t("account.profileUpdateHint")}
                                </p>
                              </div>
                            </div>

                            <div className="flex flex-col gap-3 border-b border-border/60 py-4 sm:flex-row sm:items-center sm:justify-between">
                              <div className="flex flex-col gap-1">
                                <div className="text-sm leading-6 text-foreground">
                                  {t("account.emailLabel")}
                                </div>
                                <div className="break-all text-xs text-muted-foreground">
                                  {user?.email || t("account.noEmail")}
                                </div>
                              </div>
                              <div className="flex gap-2 sm:justify-end">
                                <Button
                                  type="button"
                                  variant="outline"
                                  disabled
                                  className="h-8 rounded-lg px-3 text-sm"
                                >
                                  {t("account.emailReadonly")}
                                </Button>
                                </div>
                              </div>

                            <div className="flex flex-col gap-3 border-b border-border/60 py-4 sm:flex-row sm:items-center sm:justify-between">
                              <div className="flex flex-col gap-1">
                                <div className="text-sm leading-6 text-foreground">
                                  {t("account.userIdLabel")}
                                </div>
                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                  <span className="break-all">
                                    {user?.id || t("account.noUserId")}
                                  </span>
                                  {user?.id ? (
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon-sm"
                                      onClick={() => void handleCopyUserId()}
                                      className="h-6 w-6 rounded-md"
                                      aria-label={t("account.copyUserId")}
                                    >
                                      <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                                    </Button>
                                  ) : null}
                                </div>
                              </div>
                            </div>

                            <div className="flex flex-col gap-3 border-b border-border/60 py-4 sm:flex-row sm:items-center sm:justify-between">
                              <div className="flex flex-col gap-1">
                                <div className="text-sm leading-6 text-foreground">
                                  {t("account.changePasswordLabel")}
                                </div>
                                <div className="flex items-center gap-1.5 pt-1">
                                  {Array.from({ length: 10 }).map(
                                    (_, index) => (
                                      <span
                                        key={`account-password-dot-${index}`}
                                        className="h-2 w-2 rounded-full bg-muted-foreground/70"
                                      />
                                    ),
                                  )}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {t("account.passwordHint")}
                                </div>
                              </div>
                              <div className="flex gap-2 sm:justify-end">
                                <Button
                                  type="button"
                                  variant="outline"
                                  onClick={() =>
                                    handleUnavailableAction(
                                      t("account.passwordUpdateUnavailable"),
                                    )
                                  }
                                  className="h-8 rounded-lg px-3 text-sm"
                                >
                                  <KeyRound className="h-4 w-4" />
                                  {t("account.changePassword")}
                                </Button>
                              </div>
                            </div>

                            <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                              <div className="flex flex-col gap-1">
                                <div className="text-sm leading-6 text-foreground">
                                  {t("account.deleteAccount")}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {t("account.deleteAccountWarning")}
                                </div>
                              </div>
                              <div className="flex gap-2 sm:justify-end">
                                <Button
                                  type="button"
                                  variant="outline"
                                  onClick={() =>
                                    handleUnavailableAction(
                                      t("account.deleteAccountUnavailable"),
                                    )
                                  }
                                  className="h-8 rounded-lg border-destructive/40 px-3 text-sm text-destructive hover:bg-destructive/8 hover:text-destructive"
                                >
                                  <Trash2 className="h-4 w-4" />
                                  {t("account.deleteAccount")}
                                </Button>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="skills" className="space-y-8 mt-0">
                <UserSkillSettingsPanel
                  onError={(message) => toast.error(message)}
                />
              </TabsContent>

              <TabsContent value="connectors" className="mt-0 h-full">
                <ConnectorCenterPanel
                  targetSessionId={connectorTargetSessionId}
                  highlightedConnector={highlightedConnector}
                />
              </TabsContent>

              <TabsContent value="billing" className="mt-0">
                <BillingSettingsPanel onClose={onClose} />
              </TabsContent>
            </div>
          </div>
        </div>
      </Tabs>
    </div>
  );
}

export function SettingsDialog({
  open,
  onOpenChange,
  activeTab,
  onActiveTabChange,
  connectorTargetSessionId,
  highlightedConnector,
}: SettingsDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col w-[min(921px,calc(100vw-32px))] max-w-[921px] md:w-[min(973px,calc(100vw-32px))] md:max-w-[973px] h-[min(576px,calc(100vh-64px))] md:h-[min(608px,calc(100vh-64px))] rounded-[30px] border border-border p-0 overflow-hidden shadow-xl"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{t("settings.title")}</DialogTitle>
          <DialogDescription>{t("settings.description")}</DialogDescription>
        </DialogHeader>
        <div className="flex-1 min-h-0">
          <SettingsPanel
            activeTab={activeTab}
            onActiveTabChange={onActiveTabChange}
            onClose={() => onOpenChange(false)}
            connectorTargetSessionId={connectorTargetSessionId}
            highlightedConnector={highlightedConnector}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function GlobalSettingsDialogHost() {
  const [location] = useLocation();
  const search = useSearch();
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<SettingsTab>("settings");
  const [connectorTargetSessionId, setConnectorTargetSessionId] = useState<
    string | null
  >(null);
  const [highlightedConnector, setHighlightedConnector] =
    useState<ConnectorKey | null>(null);

  const searchState = useMemo(() => {
    const params = new URLSearchParams(search);
    const callbackPath = new URL(location, window.location.origin).pathname;
    const hasOauthCallbackParams = Boolean(params.get("state"));
    const isNotionCallback =
      callbackPath === "/notion/callback" && hasOauthCallbackParams;
    const isSupabaseCallback =
      callbackPath === "/supabase/callback" && hasOauthCallbackParams;
    const isSlackCallback =
      callbackPath === "/slack/callback" && hasOauthCallbackParams;
    const isVercelCallback =
      callbackPath === "/vercel/callback" && hasOauthCallbackParams;
    const isGithubCallback =
      callbackPath === "/github/callback" && hasOauthCallbackParams;
    return {
      shouldOpen:
        params.get("settings") === "open" ||
        params.get("settingsTab") === "connectors" ||
        params.get("connector_oauth") === "1" ||
        isNotionCallback ||
        isSupabaseCallback ||
        isSlackCallback ||
        isVercelCallback ||
        isGithubCallback,
      settingsTab:
        isNotionCallback ||
        isSupabaseCallback ||
        isSlackCallback ||
        isVercelCallback ||
        isGithubCallback
          ? "connectors"
          : params.get("settingsTab"),
      targetSessionId: params.get("targetSessionId"),
      connector: isGithubCallback
        ? "github"
        : isNotionCallback
        ? "notion"
        : isSupabaseCallback
          ? "supabase"
        : isSlackCallback
          ? "slack"
          : isVercelCallback
            ? "vercel"
            : params.get("connector"),
    };
  }, [location, search]);

  useEffect(() => {
    const handleOpen = (event: Event) => {
      const detail =
        (event as CustomEvent<OpenSettingsDialogDetail>).detail || {};
      setOpen(true);
      setActiveTab(detail.tab || "settings");
      setConnectorTargetSessionId(detail.targetSessionId || null);
      setHighlightedConnector(
        (detail.connectorKey as ConnectorKey | null) || null,
      );
    };
    window.addEventListener(
      OPEN_SETTINGS_DIALOG_EVENT,
      handleOpen as EventListener,
    );
    return () => {
      window.removeEventListener(
        OPEN_SETTINGS_DIALOG_EVENT,
        handleOpen as EventListener,
      );
    };
  }, []);

  useEffect(() => {
    const handleClose = () => {
      setOpen(false);
      setConnectorTargetSessionId(null);
      setHighlightedConnector(null);
    };
    window.addEventListener(CLOSE_SETTINGS_DIALOG_EVENT, handleClose);
    return () => {
      window.removeEventListener(CLOSE_SETTINGS_DIALOG_EVENT, handleClose);
    };
  }, []);

  useEffect(() => {
    if (!searchState.shouldOpen) return;
    setOpen(true);
    setActiveTab(
      isSettingsTab(searchState.settingsTab)
        ? searchState.settingsTab
        : "connectors",
    );
    setConnectorTargetSessionId(searchState.targetSessionId || null);
    setHighlightedConnector(
      (searchState.connector as ConnectorKey | null) || null,
    );
  }, [searchState]);

  return (
    <SettingsDialog
      open={open}
      onOpenChange={setOpen}
      activeTab={activeTab}
      onActiveTabChange={setActiveTab}
      connectorTargetSessionId={connectorTargetSessionId}
      highlightedConnector={highlightedConnector}
    />
  );
}
