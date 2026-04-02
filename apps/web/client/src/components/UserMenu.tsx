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
import { Home, LogOut, ShieldCheck, UserRoundPlus } from "lucide-react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";

export default function UserMenu() {
  const [, setLocation] = useLocation();
  const { user, status, logout } = useAuth();

  const handleLogout = async () => {
    await logout();
    setLocation("/login");
  };

  const initials = (user?.displayName || user?.email || "U").slice(0, 1).toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 rounded-full p-0"
        >
          <Avatar className="h-9 w-9">
            <AvatarImage
              src={user?.email ? `https://avatar.vercel.sh/${encodeURIComponent(user.email)}` : undefined}
              alt="User"
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
                src={user?.email ? `https://avatar.vercel.sh/${encodeURIComponent(user.email)}` : undefined}
                alt="User"
              />
              <AvatarFallback>{initials}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-foreground">
                {status === "authenticated" ? user?.displayName || user?.email : "未登录"}
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {status === "authenticated" ? user?.email : "登录后绑定你的会话与授权"}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-accent/50 p-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-emerald-600" />
              <span className="text-sm font-medium text-foreground">
                {status === "authenticated" ? "个人身份已绑定" : "尚未建立正式身份"}
              </span>
            </div>
            <div className="mt-2 text-xs text-muted-foreground">
              {status === "authenticated"
                ? "对话、skills 与连接器授权将按当前账号隔离。"
                : "请先登录或注册，再进入个人工作区。"}
            </div>
          </div>
        </div>

        <div className="p-1">
          <DropdownMenuItem
            onClick={() => setLocation("/home")}
            className="cursor-pointer py-2.5 px-3 rounded-lg"
          >
            <Home className="w-4 h-4 mr-2 text-muted-foreground" />
            <span className="text-sm">Home</span>
          </DropdownMenuItem>
          {status === "authenticated" ? (
            <DropdownMenuItem
              onClick={() => void handleLogout()}
              className="cursor-pointer rounded-lg px-3 py-2.5"
            >
              <LogOut className="mr-2 h-4 w-4 text-muted-foreground" />
              <span className="text-sm">退出登录</span>
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem asChild className="cursor-pointer rounded-lg px-3 py-2.5">
              <Link href="/register">
                <UserRoundPlus className="mr-2 h-4 w-4 text-muted-foreground" />
                <span className="text-sm">注册账号</span>
              </Link>
            </DropdownMenuItem>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
