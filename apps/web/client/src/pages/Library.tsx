/**
 * Design Philosophy: Swiss International Style + Digital Minimalism
 * Placeholder page for Library functionality
 */

import WorkspaceLayout from "@/components/WorkspaceLayout";
import { Library as LibraryIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

export default function Library() {
  const { t } = useTranslation();

  return (
    <WorkspaceLayout>
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
        <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
          <LibraryIcon className="w-8 h-8 text-primary" />
        </div>
        <h2 className="text-2xl font-semibold text-foreground">{t("libraryPage.title")}</h2>
        <p className="text-muted-foreground text-center max-w-md">
          {t("libraryPage.description")}
        </p>
      </div>
    </WorkspaceLayout>
  );
}
