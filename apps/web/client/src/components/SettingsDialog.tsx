import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { X } from 'lucide-react';

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const { t, i18n } = useTranslation();
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [pushNotifications, setPushNotifications] = useState(true);
  const [theme, setTheme] = useState('light');

  const handleLanguageChange = (lang: string) => {
    i18n.changeLanguage(lang);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full max-w-2xl rounded-xl">
        <DialogHeader className="flex flex-row items-center justify-between">
          <DialogTitle className="text-xl font-semibold">{t('settings.title')}</DialogTitle>
          <button
            onClick={() => onOpenChange(false)}
            className="rounded-md p-1 hover:bg-muted transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </DialogHeader>

        <Tabs defaultValue="settings" className="w-full">
          <TabsList className="grid w-full grid-cols-2 bg-muted rounded-lg p-1">
            <TabsTrigger value="settings" className="rounded-md data-[state=active]:bg-background">
              {t('settings.settingsTab')}
            </TabsTrigger>
            <TabsTrigger value="account" className="rounded-md data-[state=active]:bg-background">
              {t('settings.accountTab')}
            </TabsTrigger>
          </TabsList>

          {/* Settings Tab */}
          <TabsContent value="settings" className="space-y-6 mt-4">
            {/* Language Setting */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">{t('settings.languageLabel')}</Label>
              <p className="text-sm text-muted-foreground">{t('settings.languageDescription')}</p>
              <Select value={i18n.language} onValueChange={handleLanguageChange}>
                <SelectTrigger className="rounded-lg">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-lg">
                  <SelectItem value="zh" className="rounded-md">
                    {t('settings.chinese')}
                  </SelectItem>
                  <SelectItem value="en" className="rounded-md">
                    {t('settings.english')}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Theme Setting */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">{t('settings.themeLabel')}</Label>
              <p className="text-sm text-muted-foreground">{t('settings.themeDescription')}</p>
              <Select value={theme} onValueChange={setTheme}>
                <SelectTrigger className="rounded-lg">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-lg">
                  <SelectItem value="light" className="rounded-md">
                    {t('settings.light')}
                  </SelectItem>
                  <SelectItem value="dark" className="rounded-md">
                    {t('settings.dark')}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Notifications Setting */}
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

          {/* Account Tab */}
          <TabsContent value="account" className="space-y-6 mt-4">
            {/* Profile Section */}
            <div className="space-y-4">
              <Label className="text-sm font-medium">{t('account.profileLabel')}</Label>
              <div className="space-y-2">
                <Label htmlFor="email" className="text-sm text-muted-foreground">
                  {t('account.emailLabel')}
                </Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="user@example.com"
                  className="rounded-lg"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="username" className="text-sm text-muted-foreground">
                  {t('account.usernameLabel')}
                </Label>
                <Input id="username" placeholder="username" className="rounded-lg" />
              </div>
              <Button className="rounded-lg bg-foreground hover:bg-foreground/90 text-background">
                {t('account.updateProfile')}
              </Button>
            </div>

            {/* Change Password Section */}
            <div className="space-y-4 pt-4 border-t">
              <Label className="text-sm font-medium">{t('account.changePasswordLabel')}</Label>
              <div className="space-y-2">
                <Label htmlFor="current-password" className="text-sm text-muted-foreground">
                  {t('account.currentPassword')}
                </Label>
                <Input id="current-password" type="password" className="rounded-lg" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-password" className="text-sm text-muted-foreground">
                  {t('account.newPassword')}
                </Label>
                <Input id="new-password" type="password" className="rounded-lg" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-password" className="text-sm text-muted-foreground">
                  {t('account.confirmPassword')}
                </Label>
                <Input id="confirm-password" type="password" className="rounded-lg" />
              </div>
              <Button className="rounded-lg bg-foreground hover:bg-foreground/90 text-background">
                {t('account.changePassword')}
              </Button>
            </div>

            {/* Danger Zone */}
            <div className="space-y-4 pt-4 border-t border-destructive/20">
              <Label className="text-sm font-medium text-destructive">{t('account.dangerZone')}</Label>
              <p className="text-sm text-muted-foreground">{t('account.deleteAccountWarning')}</p>
              <Button variant="destructive" className="rounded-lg">
                {t('account.deleteAccount')}
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
