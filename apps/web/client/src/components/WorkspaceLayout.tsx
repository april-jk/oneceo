/**
 * Design Philosophy: Swiss International Style + Digital Minimalism
 * - Fixed sidebar + header with scrollable main content
 * - Maximum content width 1280px with centered alignment
 * - 24px grid system for consistent spacing
 */

import { useState } from "react";
import Header from "./Header";
import Sidebar from "./Sidebar";

interface WorkspaceLayoutProps {
  children: React.ReactNode;
  selectedProjectId?: string | null;
  onProjectSelect?: (projectId: string | null) => void;
}

export default function WorkspaceLayout({ children, selectedProjectId, onProjectSelect }: WorkspaceLayoutProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      <Sidebar 
        collapsed={sidebarCollapsed} 
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
        selectedProjectId={selectedProjectId}
        onProjectSelect={onProjectSelect}
      />
      <Header />
      <main className={`${sidebarCollapsed ? 'ml-16' : 'ml-60'} pt-14 min-h-screen transition-all duration-300`}>
        <div className="container py-6">{children}</div>
      </main>
    </div>
  );
}
