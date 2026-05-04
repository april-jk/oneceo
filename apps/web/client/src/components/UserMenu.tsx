/**
 * User Menu Component - Dropdown menu for user avatar
 */

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Home, LogIn, LogOut, ShieldCheck, UserRoundPlus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";

export default function UserMenu() {
  const [location, setLocation] = useLocation();
  const { user, status, logout } = useAuth();
  const { t } = useTranslation();

  const handleLogout = async () => {
    await logout();
    setLocation("/login");
  };

  const initials = (user?.displayName || user?.email || "U").slice(0, 1).toUpperCase();
  const redirectTarget = location || "/home";
  const loginHref = `/login?redirect=${encodeURIComponent(redirectTarget)}`;
  const registerHref = `/register?redirect=${encodeURIComponent(redirectTarget)}`;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 rounded-full p-0"
          aria-label={t("userMenu.avatarAlt")}
        >
            <Avatar className="h-9 w-9">
              <AvatarImage
                src={user?.avatarUrl || undefined}
                alt={t("userMenu.avatarAlt")}
              />
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64 p-0">
        <div className="border-b border-border p-4">
          <div className="mb-3 flex items-center gap-3">
            <Avatar className="h-12 w-12">
              <AvatarImage
                src={user?.avatarUrl || undefined}
                alt={t("userMenu.avatarAlt")}
              />
              <AvatarFallback>{initials}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-foreground">
                {status === "authenticated" ? user?.displayName || user?.email : t("userMenu.guestName")}
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {status === "authenticated" ? user?.email : t("userMenu.guestSubtitle")}
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-border bg-accent/50 p-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-emerald-600" />
              <span className="text-sm font-medium text-foreground">
                {status === "authenticated" ? t("userMenu.boundTitle") : t("userMenu.guestTitle")}
              </span>
            </div>
            <div className="mt-2 text-xs text-muted-foreground">
              {status === "authenticated"
                ? t("userMenu.boundDescription")
                : t("userMenu.guestDescription")}
            </div>
          </div>
        </div>

        <div className="p-1">
          {status === "authenticated" ? (
            <>
              <DropdownMenuItem
                onClick={() => setLocation("/home")}
                className="cursor-pointer rounded-lg px-3 py-2.5"
              >
                <Home className="mr-2 h-4 w-4 text-muted-foreground" />
                <span className="text-sm">{t("userMenu.workspace")}</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => void handleLogout()}
                className="cursor-pointer rounded-lg px-3 py-2.5"
              >
                <LogOut className="mr-2 h-4 w-4 text-muted-foreground" />
                <span className="text-sm">{t("userMenu.logout")}</span>
              </DropdownMenuItem>
            </>
          ) : (
            <>
              <DropdownMenuItem asChild className="cursor-pointer rounded-lg px-3 py-2.5">
                <Link href={loginHref}>
                  <LogIn className="mr-2 h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">{t("userMenu.login")}</span>
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild className="cursor-pointer rounded-lg px-3 py-2.5">
                <Link href={registerHref}>
                  <UserRoundPlus className="mr-2 h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">{t("userMenu.register")}</span>
                </Link>
              </DropdownMenuItem>
            </>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
