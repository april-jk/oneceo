/**
 * Design Philosophy: Swiss International Style + Digital Minimalism
 * Placeholder page for Search functionality
 */

import WorkspaceLayout from "@/components/WorkspaceLayout";
import { Search as SearchIcon } from "lucide-react";

export default function Search() {
  return (
    <WorkspaceLayout>
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
        <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
          <SearchIcon className="w-8 h-8 text-primary" />
        </div>
        <h2 className="text-2xl font-semibold text-foreground">Search</h2>
        <p className="text-muted-foreground text-center max-w-md">
          Search functionality will be available here
        </p>
      </div>
    </WorkspaceLayout>
  );
}
