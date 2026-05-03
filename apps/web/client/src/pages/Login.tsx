import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Eye, EyeOff, LockKeyhole, Mail } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";

function resolveRedirectTarget() {
  if (typeof window === "undefined") {
    return "/home";
  }
  const target =
    new URLSearchParams(window.location.search).get("redirect") || "/home";
  return target === "/" ? "/home" : target;
}

export default function Login() {
  const { login, status } = useAuth();
  const { t } = useTranslation();
  const [, setLocation] = useLocation();
  const redirectTarget = useMemo(resolveRedirectTarget, []);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status === "authenticated") {
      setLocation(redirectTarget);
    }
  }, [redirectTarget, setLocation, status]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login({ email: email.trim(), password });
      setLocation(redirectTarget);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : t("auth.loginFailed"),
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background px-4 py-10 text-foreground">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-[450px] items-center justify-center">
        <div className="w-full rounded-[20px] border border-border bg-card p-[30px] shadow-xl shadow-black/5">
          <div className="mb-6 flex items-center gap-3">
            <img
              src="/logo.png"
              alt="oneceo"
              className="size-11 rounded-[10px] object-cover"
            />
            <div className="space-y-1">
              <p className="text-lg font-semibold leading-none text-foreground">
                {t("auth.loginTitle")}
              </p>
              <p className="text-sm text-muted-foreground">
                {t("auth.loginSubtitle")}
              </p>
            </div>
          </div>

          <form className="flex flex-col gap-[10px]" onSubmit={handleSubmit}>
            <div className="flex flex-col gap-2">
              <Label
                htmlFor="login-email"
                className="text-sm font-semibold text-foreground"
              >
                {t("auth.emailLabel")}
              </Label>
              <div className="flex h-[50px] items-center rounded-[10px] border border-input bg-background px-[10px] transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20">
                <Mail
                  className="size-5 shrink-0 text-muted-foreground"
                  strokeWidth={1.9}
                />
                <Input
                  id="login-email"
                  type="email"
                  autoComplete="email"
                  placeholder={t("auth.emailPlaceholder")}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  className="ml-[10px] h-full border-0 bg-transparent px-0 py-0 text-[15px] text-foreground shadow-none focus-visible:ring-0"
                />
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Label
                htmlFor="login-password"
                className="text-sm font-semibold text-foreground"
              >
                {t("auth.passwordLabel")}
              </Label>
              <div className="flex h-[50px] items-center rounded-[10px] border border-input bg-background px-[10px] transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20">
                <LockKeyhole
                  className="size-5 shrink-0 text-muted-foreground"
                  strokeWidth={1.9}
                />
                <Input
                  id="login-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder={t("auth.passwordPlaceholder")}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  className="ml-[10px] h-full border-0 bg-transparent px-0 py-0 text-[15px] text-foreground shadow-none focus-visible:ring-0"
                />
                <button
                  type="button"
                  aria-label={
                    showPassword
                      ? t("common.hidePassword")
                      : t("common.showPassword")
                  }
                  onClick={() => setShowPassword((value) => !value)}
                  className="ml-2 inline-flex size-8 items-center justify-center rounded-[8px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  {showPassword ? (
                    <EyeOff className="size-4" />
                  ) : (
                    <Eye className="size-4" />
                  )}
                </button>
              </div>
            </div>

            <p className="pt-1 text-sm text-muted-foreground">
              {t("auth.loginHint")}
            </p>

            {error ? (
              <div className="rounded-[10px] border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                {error}
              </div>
            ) : null}

            <Button
              type="submit"
              className="mt-[10px] h-[50px] w-full rounded-[10px] bg-primary text-[15px] font-medium text-primary-foreground hover:bg-primary/90"
              disabled={submitting}
            >
              {submitting ? t("auth.signingIn") : t("auth.signIn")}
            </Button>
          </form>

          <p className="mt-5 text-center text-sm text-muted-foreground">
            {t("auth.noAccount")}
            <Link
              href={`/register?redirect=${encodeURIComponent(redirectTarget)}`}
              className="ml-1 font-medium text-primary"
            >
              {t("auth.signUp")}
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
