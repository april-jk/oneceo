import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Eye, EyeOff, LockKeyhole, Mail, UserRound } from "lucide-react";
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
  return new URLSearchParams(window.location.search).get("redirect") || "/home";
}

export default function Register() {
  const { register, sendRegisterCode, status } = useAuth();
  const { t } = useTranslation();
  const [, setLocation] = useLocation();
  const redirectTarget = useMemo(resolveRedirectTarget, []);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [codeSentMessage, setCodeSentMessage] = useState<string | null>(null);
  const [codeCooldownSeconds, setCodeCooldownSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const trimmedEmail = email.trim();
  const hasValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail);
  const canSendCode = hasValidEmail && codeCooldownSeconds === 0 && !sendingCode;

  useEffect(() => {
    if (status === "authenticated") {
      setLocation(redirectTarget);
    }
  }, [redirectTarget, setLocation, status]);

  useEffect(() => {
    if (codeCooldownSeconds <= 0) {
      return;
    }
    const timer = window.setTimeout(() => {
      setCodeCooldownSeconds((value) => Math.max(0, value - 1));
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [codeCooldownSeconds]);

  const handleSendCode = async () => {
    if (!hasValidEmail) {
      setError(t("auth.invalidEmail"));
      return;
    }
    setSendingCode(true);
    setError(null);
    setCodeSentMessage(null);
    try {
      const result = await sendRegisterCode({
        email: trimmedEmail,
      });
      const cooldown = Math.max(0, Number(result.cooldownSeconds || 0));
      const expiresInSeconds = Math.max(0, Number(result.expiresInSeconds || 0));
      setCodeCooldownSeconds(cooldown);
      setCodeSentMessage(
        expiresInSeconds > 0
          ? t("auth.codeSentWithExpiry", { email: trimmedEmail, minutes: Math.ceil(expiresInSeconds / 60) })
          : t("auth.codeSent", { email: trimmedEmail })
      );
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : t("auth.sendCodeFailed"));
    } finally {
      setSendingCode(false);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!verificationCode.trim()) {
      setError(t("auth.verificationCodeRequired"));
      return;
    }
    if (password !== confirmPassword) {
      setError(t("auth.passwordMismatch"));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await register({
        displayName: displayName.trim(),
        email: trimmedEmail,
        password,
        verificationCode: verificationCode.trim(),
      });
      setLocation(redirectTarget);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : t("auth.registerFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#f6f3ec_0%,#fbfaf7_42%,#ffffff_100%)] px-4 py-10 text-slate-900">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-[450px] items-center justify-center">
        <div className="w-full rounded-[20px] border border-black/10 bg-white p-[30px] shadow-[0_20px_60px_rgba(15,23,42,0.08)]">
          <div className="mb-6 flex items-center gap-3">
            <img src="/logo.png" alt="oneceo" className="size-11 rounded-[10px] object-cover" />
            <div className="space-y-1">
              <p className="text-lg font-semibold leading-none text-[#151717]">{t("auth.registerTitle")}</p>
              <p className="text-sm text-slate-500">{t("auth.registerSubtitle")}</p>
            </div>
          </div>

          <form className="flex flex-col gap-[10px]" onSubmit={handleSubmit}>
            <div className="flex flex-col gap-2">
              <Label htmlFor="register-display-name" className="text-sm font-semibold text-[#151717]">
                {t("auth.nameLabel")}
              </Label>
              <div className="flex h-[50px] items-center rounded-[10px] border-[1.5px] border-[#ecedec] px-[10px] transition-colors focus-within:border-[#2d79f3]">
                <UserRound className="size-5 shrink-0 text-[#151717]" strokeWidth={1.9} />
                <Input
                  id="register-display-name"
                  autoComplete="name"
                  placeholder={t("auth.namePlaceholder")}
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  required
                  className="ml-[10px] h-full border-0 bg-transparent px-0 py-0 text-[15px] shadow-none focus-visible:ring-0"
                />
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="register-email" className="text-sm font-semibold text-[#151717]">
                {t("auth.emailLabel")}
              </Label>
              <div className="flex h-[50px] items-center rounded-[10px] border-[1.5px] border-[#ecedec] px-[10px] transition-colors focus-within:border-[#2d79f3]">
                <Mail className="size-5 shrink-0 text-[#151717]" strokeWidth={1.9} />
                <Input
                  id="register-email"
                  type="email"
                  autoComplete="email"
                  placeholder={t("auth.emailPlaceholder")}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  className="ml-[10px] h-full border-0 bg-transparent px-0 py-0 text-[15px] shadow-none focus-visible:ring-0"
                />
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="register-verification-code" className="text-sm font-semibold text-[#151717]">
                {t("auth.verificationCodeLabel")}
              </Label>
              <div className="flex gap-2">
                <div className="flex h-[50px] flex-1 items-center rounded-[10px] border-[1.5px] border-[#ecedec] px-[10px] transition-colors focus-within:border-[#2d79f3]">
                  <Mail className="size-5 shrink-0 text-[#151717]" strokeWidth={1.9} />
                  <Input
                    id="register-verification-code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder={t("auth.verificationCodePlaceholder")}
                    value={verificationCode}
                    onChange={(event) => setVerificationCode(event.target.value)}
                    required
                    className="ml-[10px] h-full border-0 bg-transparent px-0 py-0 text-[15px] shadow-none focus-visible:ring-0"
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void handleSendCode()}
                  disabled={!canSendCode}
                  className="h-[50px] min-w-[124px] rounded-[10px] border-[#151717] px-4 text-[14px] font-medium text-[#151717] hover:bg-slate-50"
                >
                  {sendingCode
                    ? t("auth.sendingCode")
                    : codeCooldownSeconds > 0
                      ? t("auth.codeCooldown", { seconds: codeCooldownSeconds })
                      : t("auth.sendCode")}
                </Button>
              </div>
              {codeSentMessage ? <p className="text-sm text-emerald-700">{codeSentMessage}</p> : null}
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="register-password" className="text-sm font-semibold text-[#151717]">
                {t("auth.passwordLabel")}
              </Label>
              <div className="flex h-[50px] items-center rounded-[10px] border-[1.5px] border-[#ecedec] px-[10px] transition-colors focus-within:border-[#2d79f3]">
                <LockKeyhole className="size-5 shrink-0 text-[#151717]" strokeWidth={1.9} />
                <Input
                  id="register-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  placeholder={t("auth.passwordPlaceholder")}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  className="ml-[10px] h-full border-0 bg-transparent px-0 py-0 text-[15px] shadow-none focus-visible:ring-0"
                />
                <button
                  type="button"
                  aria-label={showPassword ? t("common.hidePassword") : t("common.showPassword")}
                  onClick={() => setShowPassword((value) => !value)}
                  className="ml-2 inline-flex size-8 items-center justify-center rounded-[8px] text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="register-confirm-password" className="text-sm font-semibold text-[#151717]">
                {t("auth.confirmPasswordLabel")}
              </Label>
              <div className="flex h-[50px] items-center rounded-[10px] border-[1.5px] border-[#ecedec] px-[10px] transition-colors focus-within:border-[#2d79f3]">
                <LockKeyhole className="size-5 shrink-0 text-[#151717]" strokeWidth={1.9} />
                <Input
                  id="register-confirm-password"
                  type={showConfirmPassword ? "text" : "password"}
                  autoComplete="new-password"
                  placeholder={t("auth.confirmPasswordPlaceholder")}
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  required
                  className="ml-[10px] h-full border-0 bg-transparent px-0 py-0 text-[15px] shadow-none focus-visible:ring-0"
                />
                <button
                  type="button"
                  aria-label={showConfirmPassword ? t("common.hidePassword") : t("common.showPassword")}
                  onClick={() => setShowConfirmPassword((value) => !value)}
                  className="ml-2 inline-flex size-8 items-center justify-center rounded-[8px] text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
                >
                  {showConfirmPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>

            <p className="pt-1 text-sm text-slate-500">{t("auth.registerHint")}</p>

            {error ? (
              <div className="rounded-[10px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
            ) : null}

            <Button
              type="submit"
              className="mt-[10px] h-[50px] w-full rounded-[10px] bg-[#151717] text-[15px] font-medium text-white hover:bg-[#252727]"
              disabled={submitting}
            >
              {submitting ? t("auth.creatingAccount") : t("auth.createAccount")}
            </Button>
          </form>

          <p className="mt-5 text-center text-sm text-slate-700">
            {t("auth.hasAccount")}
            <Link
              href={`/login?redirect=${encodeURIComponent(redirectTarget)}`}
              className="ml-1 font-medium text-[#2d79f3]"
            >
              {t("auth.signIn")}
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
