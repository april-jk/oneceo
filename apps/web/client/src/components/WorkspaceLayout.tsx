/**
 * Design Philosophy: Swiss International Style + Digital Minimalism
 * - Fixed sidebar + header with scrollable main content
 * - Maximum content width 1280px with centered alignment
 * - 24px grid system for consistent spacing
 */

import { useState } from "react";
import Sidebar from "./Sidebar";
import type { TaskProjectSelection } from "@/lib/task-project-selection";

interface WorkspaceLayoutProps {
  children: React.ReactNode;
  selectedProject?: TaskProjectSelection | null;
  fluid?: boolean;
  lockViewport?: boolean;
}

export default function WorkspaceLayout({
  children,
  selectedProject,
  fluid = false,
  lockViewport = false,
}: WorkspaceLayoutProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <div
      className={
        lockViewport
          ? "h-screen overflow-hidden bg-background"
          : "min-h-screen bg-background"
      }
    >
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
        selectedProject={selectedProject}
      />
      <main
        className={`${sidebarCollapsed ? "ml-20" : "ml-64"} pt-4 pb-4 transition-all duration-300 ${lockViewport ? "h-screen overflow-hidden" : "min-h-screen"}`}
      >
        <div
          className={
            fluid
              ? `w-full py-0 ${lockViewport ? "h-full overflow-hidden px-3 sm:px-4 lg:px-5" : "px-3 sm:px-4 lg:px-5"}`
              : "container py-0"
          }
        >
          {children}
        </div>
      </main>
    </div>
  );
}
