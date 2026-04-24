import type { ReactNode } from "react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";

export function RequireUserAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const { t } = useTranslation();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (status !== "anonymous") {
      return;
    }
    const redirectTarget = `${window.location.pathname}${window.location.search}`;
    setLocation(`/login?redirect=${encodeURIComponent(redirectTarget)}`);
  }, [setLocation, status]);

  if (status === "loading") {
    return (
      <div className="min-h-screen bg-background px-6 py-10 text-foreground">
        <div className="mx-auto flex min-h-[80vh] max-w-5xl items-center justify-center">
          <div className="rounded-[28px] border border-border bg-card/90 px-8 py-6 text-sm text-muted-foreground shadow-xl shadow-black/5 backdrop-blur-xl">
            {t("requireAuth.verifying")}
          </div>
        </div>
      </div>
    );
  }

  if (status !== "authenticated") {
    return null;
  }

  return <>{children}</>;
}
