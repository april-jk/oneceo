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
      <div className="min-h-screen bg-[linear-gradient(180deg,#f4f1ea_0%,#ffffff_38%,#efe7da_100%)] px-6 py-10 text-slate-900">
        <div className="mx-auto flex min-h-[80vh] max-w-5xl items-center justify-center">
          <div className="rounded-[28px] border border-black/10 bg-white/85 px-8 py-6 text-sm shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur-xl">
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
