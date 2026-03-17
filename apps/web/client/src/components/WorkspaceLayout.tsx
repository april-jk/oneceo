/**
 * Design Philosophy: Swiss International Style + Digital Minimalism
 * - Fixed sidebar + header with scrollable main content
 * - Maximum content width 1280px with centered alignment
 * - 24px grid system for consistent spacing
 */

import { useState } from "react";
import Sidebar from "./Sidebar";

interface WorkspaceLayoutProps {
  children: React.ReactNode;
  selectedProjectId?: string | null;
  onProjectSelect?: (projectId: string | null) => void;
  fluid?: boolean;
}

export default function WorkspaceLayout({
  children,
  selectedProjectId,
  onProjectSelect,
  fluid = false,
}: WorkspaceLayoutProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
        selectedProjectId={selectedProjectId}
        onProjectSelect={onProjectSelect}
      />
      <main
        className={`${sidebarCollapsed ? "ml-20" : "ml-64"} pt-4 pb-4 min-h-screen transition-all duration-300`}
      >
        <div
          className={
            fluid ? "w-full px-4 py-0 sm:px-6 lg:px-8" : "container py-0"
          }
        >
          {children}
        </div>
      </main>
    </div>
  );
}
