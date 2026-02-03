/**
 * Design Philosophy: Swiss International Style + Digital Minimalism
 * - Clean horizontal layout with precise spacing
 * - Minimal visual weight to keep focus on content
 * - Single border bottom for separation
 */

import { Button } from "@/components/ui/button";
import { Bell, Settings } from "lucide-react";
import { useState } from "react";
import { SettingsDialog } from "@/components/SettingsDialog";
import UserMenu from "@/components/UserMenu";

interface HeaderProps {
  className?: string;
}

export default function Header({ className = "" }: HeaderProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  return (
    <header
      className={`fixed top-0 right-0 left-60 h-14 bg-card border-b border-border flex items-center justify-between px-6 z-10 shadow-sm ${className}`}
    >
      {/* Left Section - Breadcrumb or Title */}
      <div className="flex items-center gap-4">
        {/* Reserved for breadcrumb or page title */}
      </div>

      {/* Right Section - Actions */}
      <div className="flex items-center gap-3">
        {/* Notifications */}
        <Button variant="ghost" size="icon" className="h-9 w-9">
          <Bell className="w-4 h-4" />
        </Button>

        {/* Settings */}
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9"
          onClick={() => setSettingsOpen(true)}
        >
          <Settings className="w-4 h-4" />
        </Button>

        {/* User Menu */}
        <UserMenu />
      </div>

      {/* Settings Dialog */}
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </header>
  );
}
