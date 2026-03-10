/**
 * Design Philosophy: Swiss International Style + Digital Minimalism
 * - Clean horizontal layout with precise spacing
 * - Minimal visual weight to keep focus on content
 * - Single border bottom for separation
 */

import { Button } from "@/components/ui/button";
import { Bell, Settings } from "lucide-react";
import UserMenu from "@/components/UserMenu";
import { openSettingsDialog } from "@/lib/settings-dialog-events";

interface HeaderProps {
  className?: string;
  sidebarCollapsed?: boolean;
  hidden?: boolean;
}

export function HeaderActions({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <Button variant="ghost" size="icon" className="h-9 w-9">
        <Bell className="w-4 h-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-9 w-9"
        onClick={() => openSettingsDialog({ tab: "settings" })}
      >
        <Settings className="w-4 h-4" />
      </Button>
      <UserMenu />
    </div>
  );
}

export default function Header({ className = "", hidden = false }: HeaderProps) {
  if (hidden) return null;
  return (
    <header
      className={`fixed top-4 right-4 h-14 bg-card/95 border border-border flex items-center px-4 z-20 shadow-lg rounded-2xl backdrop-blur ${className}`}
    >
      <HeaderActions />
    </header>
  );
}
