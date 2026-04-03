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

export default function Login() {
  const { login, status } = useAuth();
  const [, setLocation] = useLocation();
  const redirectTarget = useMemo(resolveRedirectTarget, []);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
      setError(submitError instanceof Error ? submitError.message : "登录失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen overflow-hidden bg-[linear-gradient(180deg,#ede6da_0%,#f8f7f2_35%,#ffffff_100%)] text-slate-900">
      <div className="mx-auto grid min-h-screen max-w-6xl gap-10 px-6 py-8 lg:grid-cols-[1.1fr_0.9fr] lg:px-10">
        <section className="relative flex min-h-[320px] flex-col justify-between rounded-[36px] border border-black/10 bg-[radial-gradient(circle_at_top_left,#d2c3aa_0%,rgba(255,255,255,0)_34%),linear-gradient(160deg,#1f2937_0%,#312e2b_56%,#8a6d46_100%)] p-8 text-white shadow-[0_24px_80px_rgba(15,23,42,0.16)]">
          <div className="space-y-5">
            <div className="inline-flex rounded-full border border-white/20 bg-white/10 px-4 py-1 text-xs uppercase tracking-[0.28em] text-white/80">
              Oneceo Identity
            </div>
            <h1 className="max-w-xl text-4xl font-semibold leading-tight tracking-[-0.04em] lg:text-5xl">
              登录后，所有对话、skills 与连接器授权都会固定回挂到你的个人身份。
            </h1>
            <p className="max-w-xl text-sm leading-6 text-white/78 lg:text-base">
              这次切换不再依赖浏览器本地生成的伪用户头。主站会用真实用户会话来绑定任务、附件、Altus 输入和连接器配置。
            </p>
          </div>
          <div className="grid gap-3 text-sm text-white/82 sm:grid-cols-3">
            <div className="rounded-[22px] border border-white/12 bg-white/8 p-4 backdrop-blur">
              <div className="text-2xl font-semibold">1</div>
              <div className="mt-2">账户登录态</div>
            </div>
            <div className="rounded-[22px] border border-white/12 bg-white/8 p-4 backdrop-blur">
              <div className="text-2xl font-semibold">1:1</div>
              <div className="mt-2">会话与个人归属</div>
            </div>
            <div className="rounded-[22px] border border-white/12 bg-white/8 p-4 backdrop-blur">
              <div className="text-2xl font-semibold">0</div>
              <div className="mt-2">匿名入口保留</div>
            </div>
          </div>
        </section>

        <section className="flex items-center justify-center">
          <div className="w-full max-w-md rounded-[32px] border border-black/10 bg-white/92 p-8 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur-xl">
            <div className="mb-8 space-y-2">
              <p className="text-sm uppercase tracking-[0.24em] text-slate-500">用户登录</p>
              <h2 className="text-3xl font-semibold tracking-[-0.04em] text-slate-900">进入你的工作区</h2>
              <p className="text-sm leading-6 text-slate-500">使用已注册邮箱登录，服务端会恢复你的个人会话和身份绑定。</p>
            </div>

            <form className="space-y-5" onSubmit={handleSubmit}>
              <div className="space-y-2">
                <Label htmlFor="login-email">邮箱</Label>
                <Input
                  id="login-email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="login-password">密码</Label>
                <Input
                  id="login-password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="请输入密码"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
              </div>

              {error ? (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
              ) : null}

              <Button
                type="submit"
                className="h-11 w-full rounded-2xl bg-slate-900 text-white hover:bg-slate-800"
                disabled={submitting}
              >
                {submitting ? "登录中..." : "登录"}
              </Button>
            </form>

            <div className="mt-6 flex items-center justify-between text-sm text-slate-500">
              <span>还没有账号？</span>
              <Link href={`/register?redirect=${encodeURIComponent(redirectTarget)}`} className="font-medium text-slate-900 underline-offset-4 hover:underline">
                去注册
              </Link>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
