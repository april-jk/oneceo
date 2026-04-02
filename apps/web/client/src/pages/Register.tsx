import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
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
  const { register, status } = useAuth();
  const [, setLocation] = useLocation();
  const redirectTarget = useMemo(resolveRedirectTarget, []);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status === "authenticated") {
      setLocation(redirectTarget);
    }
  }, [redirectTarget, setLocation, status]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (password !== confirmPassword) {
      setError("两次输入的密码不一致");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await register({
        displayName: displayName.trim(),
        email: email.trim(),
        password,
      });
      setLocation(redirectTarget);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "注册失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen overflow-hidden bg-[linear-gradient(180deg,#f5efe6_0%,#fff9f2_42%,#ffffff_100%)] text-slate-900">
      <div className="mx-auto grid min-h-screen max-w-6xl gap-10 px-6 py-8 lg:grid-cols-[0.95fr_1.05fr] lg:px-10">
        <section className="order-2 flex items-center justify-center lg:order-1">
          <div className="w-full max-w-md rounded-[32px] border border-black/10 bg-white/92 p-8 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur-xl">
            <div className="mb-8 space-y-2">
              <p className="text-sm uppercase tracking-[0.24em] text-slate-500">创建账户</p>
              <h2 className="text-3xl font-semibold tracking-[-0.04em] text-slate-900">注册个人身份</h2>
              <p className="text-sm leading-6 text-slate-500">注册成功后会立即建立用户会话，后续创建的对话和授权都绑定到这个身份。</p>
            </div>

            <form className="space-y-5" onSubmit={handleSubmit}>
              <div className="space-y-2">
                <Label htmlFor="register-display-name">用户名</Label>
                <Input
                  id="register-display-name"
                  autoComplete="name"
                  placeholder="你的显示名称"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="register-email">邮箱</Label>
                <Input
                  id="register-email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="register-password">密码</Label>
                <Input
                  id="register-password"
                  type="password"
                  autoComplete="new-password"
                  placeholder="至少 8 位"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="register-confirm-password">确认密码</Label>
                <Input
                  id="register-confirm-password"
                  type="password"
                  autoComplete="new-password"
                  placeholder="再次输入密码"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  required
                />
              </div>

              {error ? (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
              ) : null}

              <Button
                type="submit"
                className="h-11 w-full rounded-2xl bg-[#8b5e34] text-white hover:bg-[#744b27]"
                disabled={submitting}
              >
                {submitting ? "注册中..." : "注册并进入工作区"}
              </Button>
            </form>

            <div className="mt-6 flex items-center justify-between text-sm text-slate-500">
              <span>已经有账号？</span>
              <Link href={`/login?redirect=${encodeURIComponent(redirectTarget)}`} className="font-medium text-slate-900 underline-offset-4 hover:underline">
                返回登录
              </Link>
            </div>
          </div>
        </section>

        <section className="order-1 flex min-h-[320px] flex-col justify-between rounded-[36px] border border-black/10 bg-[radial-gradient(circle_at_22%_18%,rgba(255,255,255,0.3),transparent_24%),linear-gradient(165deg,#5b4632_0%,#b38756_55%,#f2e2c9_100%)] p-8 text-white shadow-[0_24px_80px_rgba(15,23,42,0.14)] lg:order-2">
          <div className="space-y-5">
            <div className="inline-flex rounded-full border border-white/25 bg-white/12 px-4 py-1 text-xs uppercase tracking-[0.28em] text-white/80">
              Account Bootstrap
            </div>
            <h1 className="max-w-xl text-4xl font-semibold leading-tight tracking-[-0.04em] lg:text-5xl">
              从注册开始，把会话、附件、连接器授权和 skills 全部绑定到真实账号。
            </h1>
          </div>

          <div className="grid gap-3 text-sm text-white/88">
            <div className="rounded-[22px] border border-white/14 bg-white/10 p-4 backdrop-blur">
              登录 cookie 与用户表分离于管理员体系，不共表、不共 session、不共入口。
            </div>
            <div className="rounded-[22px] border border-white/14 bg-white/10 p-4 backdrop-blur">
              后续打开会话、恢复 Altus 运行态、读取 workspace，都会先按当前用户做授权校验。
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
