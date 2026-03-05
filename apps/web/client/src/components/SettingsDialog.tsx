import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Settings2, SlidersHorizontal, UserRound, X } from 'lucide-react';

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsPanel() {
  const { t, i18n } = useTranslation();
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [pushNotifications, setPushNotifications] = useState(true);
  const [theme, setTheme] = useState('light');
  const [executor, setExecutor] = useState('opencode');
  // Altus 控制模式：
  // - sandbox: 直通模式，前端输入直接转发到 sandbox 内执行器（当前为 OpenCode）。
  // - managed: Altus 接管模式，走三层智能体编排。
  // 预留后续 claudecode/codex 直通模式扩展，保持此枚举语义稳定。
  const [altusMode, setAltusMode] = useState('sandbox');
  const EXECUTOR_STORAGE_KEY = 'altus_executor';
  const ALTUS_MODE_STORAGE_KEY = 'altus_mode';

  const handleLanguageChange = (lang: string) => {
    i18n.changeLanguage(lang);
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const storedExecutor = window.localStorage.getItem(EXECUTOR_STORAGE_KEY);
    const storedAltusMode = window.localStorage.getItem(ALTUS_MODE_STORAGE_KEY);
    if (storedExecutor) {
      setExecutor(storedExecutor);
    } else {
      window.localStorage.setItem(EXECUTOR_STORAGE_KEY, executor);
    }
    if (storedAltusMode) {
      setAltusMode(storedAltusMode);
    } else {
      window.localStorage.setItem(ALTUS_MODE_STORAGE_KEY, altusMode);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(EXECUTOR_STORAGE_KEY, executor);
    window.localStorage.setItem(ALTUS_MODE_STORAGE_KEY, altusMode);
    window.dispatchEvent(
      new CustomEvent('altus-settings-changed', {
        detail: { executor, altusMode },
      })
    );
  }, [executor, altusMode]);

  return (
    <div className="h-full">
      <Tabs defaultValue="settings" className="h-full">
        <div className="flex h-full flex-col md:flex-row">
          <aside className="md:w-[240px] shrink-0 border-b md:border-b-0 md:border-r border-border bg-muted/30 flex flex-col min-h-0">
            <div className="hidden md:flex items-center px-6 pt-6 pb-4">
              <div className="text-base font-semibold text-foreground">{t('settings.title')}</div>
            </div>
            <div className="px-4 md:px-3 pb-4 md:pb-6 flex-1 min-h-0">
              <TabsList className="flex h-full flex-shrink-0 items-start justify-start self-stretch px-1.5 overflow-x-auto md:overflow-x-visible md:overflow-y-auto w-full md:flex-col md:gap-3 gap-3 bg-transparent">
                <div className="flex md:gap-2 gap-3 md:flex-col items-start self-stretch">
                  <TabsTrigger
                    value="account"
                    className="flex px-2 py-2.5 items-center text-[14px] leading-5 text-foreground max-md:whitespace-nowrap md:h-9 md:gap-2 md:self-stretch md:px-4 md:rounded-lg hover:bg-muted/60 data-[state=active]:bg-muted/60 data-[state=active]:font-medium max-md:border-b-2 max-md:border-foreground"
                  >
                    <span className="hidden md:block text-muted-foreground data-[state=active]:text-foreground">
                      <UserRound className="h-4 w-4" />
                    </span>
                    <span className="truncate">{t('settings.accountTab')}</span>
                  </TabsTrigger>
                  <TabsTrigger
                    value="model"
                    className="flex px-2 py-2.5 items-center text-[14px] leading-5 text-foreground max-md:whitespace-nowrap md:h-9 md:gap-2 md:self-stretch md:px-4 md:rounded-lg hover:bg-muted/60 data-[state=active]:bg-muted/60 data-[state=active]:font-medium max-md:border-b-2 max-md:border-foreground"
                  >
                    <span className="hidden md:block text-muted-foreground data-[state=active]:text-foreground">
                      <SlidersHorizontal className="h-4 w-4" />
                    </span>
                    <span className="truncate">{t('settings.modelTab')}</span>
                  </TabsTrigger>
                  <TabsTrigger
                    value="settings"
                    className="flex px-2 py-2.5 items-center text-[14px] leading-5 text-foreground max-md:whitespace-nowrap md:h-9 md:gap-2 md:self-stretch md:px-4 md:rounded-lg hover:bg-muted/60 data-[state=active]:bg-muted/60 data-[state=active]:font-medium max-md:border-b-2 max-md:border-foreground"
                  >
                    <span className="hidden md:block text-muted-foreground data-[state=active]:text-foreground">
                      <Settings2 className="h-4 w-4" />
                    </span>
                    <span className="truncate">{t('settings.settingsTab')}</span>
                  </TabsTrigger>
                </div>
              </TabsList>
            </div>
          </aside>

          <div className="flex-1 min-w-0 flex flex-col bg-background">
            <div className="flex-1 overflow-y-auto px-6 py-6 md:px-8 md:py-8 space-y-10">
              {/* Settings Tab */}
              <TabsContent value="settings" className="space-y-8 mt-0">
                <div className="space-y-4 pb-6 border-b border-border/60">
                  <div>
                    <Label className="text-sm font-medium">{t('settings.languageLabel')}</Label>
                    <p className="text-sm text-muted-foreground">{t('settings.languageDescription')}</p>
                  </div>
                  <Select value={i18n.language} onValueChange={handleLanguageChange}>
                    <SelectTrigger className="w-full max-w-xs rounded-xl">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl">
                      <SelectItem value="zh" className="rounded-md">
                        {t('settings.chinese')}
                      </SelectItem>
                      <SelectItem value="en" className="rounded-md">
                        {t('settings.english')}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-4 pb-6 border-b border-border/60">
                  <div>
                    <Label className="text-sm font-medium">{t('settings.themeLabel')}</Label>
                    <p className="text-sm text-muted-foreground">{t('settings.themeDescription')}</p>
                  </div>
                  <Select value={theme} onValueChange={setTheme}>
                    <SelectTrigger className="w-full max-w-xs rounded-xl">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl">
                      <SelectItem value="light" className="rounded-md">
                        {t('settings.light')}
                      </SelectItem>
                      <SelectItem value="dark" className="rounded-md">
                        {t('settings.dark')}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-4">
                  <div>
                    <Label className="text-sm font-medium">{t('settings.notificationsLabel')}</Label>
                    <p className="text-sm text-muted-foreground">{t('settings.notificationsDescription')}</p>
                  </div>
                  <div className="flex items-center justify-between">
                    <Label htmlFor="email-notifications" className="text-sm">
                      {t('settings.emailNotifications')}
                    </Label>
                    <Switch
                      id="email-notifications"
                      checked={emailNotifications}
                      onCheckedChange={setEmailNotifications}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label htmlFor="push-notifications" className="text-sm">
                      {t('settings.pushNotifications')}
                    </Label>
                    <Switch
                      id="push-notifications"
                      checked={pushNotifications}
                      onCheckedChange={setPushNotifications}
                    />
                  </div>
                </div>
              </TabsContent>

              {/* Model Tab */}
              <TabsContent value="model" className="space-y-8 mt-0">
                <div className="space-y-4 pb-6 border-b border-border/60">
                  <div>
                    <Label className="text-sm font-medium">{t('settings.executorLabel')}</Label>
                    <p className="text-sm text-muted-foreground">{t('settings.executorDescription')}</p>
                  </div>
                  <Select value={executor} onValueChange={setExecutor}>
                    <SelectTrigger className="w-full max-w-xs rounded-xl">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl">
                      <SelectItem value="opencode" className="rounded-md">
                        {t('settings.executorOpencode')}
                      </SelectItem>
                      <SelectItem value="claudecode" className="rounded-md">
                        {t('settings.executorClaudecode')}
                      </SelectItem>
                      <SelectItem value="codex" className="rounded-md">
                        {t('settings.executorCodex')}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-4">
                  <div>
                    <Label className="text-sm font-medium">{t('settings.altusControlLabel')}</Label>
                    <p className="text-sm text-muted-foreground">{t('settings.altusControlDescription')}</p>
                  </div>
                  <Select value={altusMode} onValueChange={setAltusMode}>
                    <SelectTrigger className="w-full max-w-xs rounded-xl">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl">
                      <SelectItem value="sandbox" className="rounded-md">
                        {t('settings.altusSandboxDirect')}
                      </SelectItem>
                      <SelectItem value="managed" className="rounded-md">
                        {t('settings.altusManaged')}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </TabsContent>

              {/* Account Tab */}
              <TabsContent value="account" className="space-y-8 mt-0">
                <div className="space-y-4 pb-6 border-b border-border/60">
                  <Label className="text-sm font-medium">{t('account.profileLabel')}</Label>
                  <div className="space-y-2">
                    <Label htmlFor="email" className="text-sm text-muted-foreground">
                      {t('account.emailLabel')}
                    </Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="user@example.com"
                      className="rounded-xl"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="username" className="text-sm text-muted-foreground">
                      {t('account.usernameLabel')}
                    </Label>
                    <Input id="username" placeholder="username" className="rounded-xl" />
                  </div>
                  <Button className="rounded-xl bg-foreground hover:bg-foreground/90 text-background">
                    {t('account.updateProfile')}
                  </Button>
                </div>

                <div className="space-y-4 pb-6 border-b border-border/60">
                  <Label className="text-sm font-medium">{t('account.changePasswordLabel')}</Label>
                  <div className="space-y-2">
                    <Label htmlFor="current-password" className="text-sm text-muted-foreground">
                      {t('account.currentPassword')}
                    </Label>
                    <Input id="current-password" type="password" className="rounded-xl" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="new-password" className="text-sm text-muted-foreground">
                      {t('account.newPassword')}
                    </Label>
                    <Input id="new-password" type="password" className="rounded-xl" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="confirm-password" className="text-sm text-muted-foreground">
                      {t('account.confirmPassword')}
                    </Label>
                    <Input id="confirm-password" type="password" className="rounded-xl" />
                  </div>
                  <Button className="rounded-xl bg-foreground hover:bg-foreground/90 text-background">
                    {t('account.changePassword')}
                  </Button>
                </div>

                <div className="space-y-4 pt-2 border-t border-destructive/20">
                  <Label className="text-sm font-medium text-destructive">{t('account.dangerZone')}</Label>
                  <p className="text-sm text-muted-foreground">{t('account.deleteAccountWarning')}</p>
                  <Button variant="destructive" className="rounded-xl">
                    {t('account.deleteAccount')}
                  </Button>
                </div>
              </TabsContent>
            </div>
          </div>
        </div>
      </Tabs>
    </div>
  );
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col w-[min(921px,calc(100vw-32px))] max-w-[921px] md:w-[min(973px,calc(100vw-32px))] md:max-w-[973px] h-[min(576px,calc(100vh-64px))] md:h-[min(608px,calc(100vh-64px))] rounded-[28px] p-0 overflow-hidden border shadow-xl"
      >
        <button
          onClick={() => onOpenChange(false)}
          className="absolute right-6 top-6 z-10 rounded-md p-1 hover:bg-muted transition-colors"
        >
          <X className="h-5 w-5" />
        </button>
        <div className="flex-1 min-h-0">
          <SettingsPanel />
        </div>
      </DialogContent>
    </Dialog>
  );
}
