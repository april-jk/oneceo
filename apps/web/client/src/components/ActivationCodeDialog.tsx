import { useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  Diamond,
  Gift,
  CheckCircle,
  ArrowRight,
  Copy,
  Sparkles,
} from "lucide-react";

interface ActivationCodeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentBalance?: number;
  onSuccess?: (newBalance: number) => void;
}

export function ActivationCodeDialog({
  open,
  onOpenChange,
  currentBalance = 0,
  onSuccess,
}: ActivationCodeDialogProps) {
  const [code, setCode] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<{
    success: boolean;
    creditsGranted: number;
    newBalance: number;
    message: string;
  } | null>(null);

  const handleCodeChange = useCallback((value: string) => {
    // 自动格式化激活码（转大写并过滤非法字符）；允许更长前缀场景
    const formatted = value
      .toUpperCase()
      .replace(/[^A-Z0-9-]/g, "")
      .slice(0, 128);
    setCode(formatted);
    setResult(null);
  }, []);

  const handleRedeem = useCallback(async () => {
    if (!code.trim()) {
      toast.error("请输入激活码");
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch("/api/activation-codes/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ code: code.trim() }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setResult({
          success: true,
          creditsGranted: data.creditsGranted,
          newBalance: data.newBalance,
          message: data.message,
        });
        toast.success("兑换成功", {
          description: `获得 ${data.creditsGranted.toLocaleString()} 积分`,
        });
        onSuccess?.(data.newBalance);
      } else {
        setResult({
          success: false,
          creditsGranted: 0,
          newBalance: currentBalance,
          message: data.error || "兑换失败",
        });
        toast.error("兑换失败", {
          description: data.error || "激活码无效或已使用",
        });
      }
    } catch (error) {
      console.error("兑换激活码失败:", error);
      toast.error("兑换失败", {
        description: "网络错误，请稍后重试",
      });
    } finally {
      setIsSubmitting(false);
    }
  }, [code, currentBalance, onSuccess]);

  const handleClose = useCallback(() => {
    setCode("");
    setResult(null);
    onOpenChange(false);
  }, [onOpenChange]);

  const copyToClipboard = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("已复制到剪贴板");
    } catch {
      toast.error("复制失败");
    }
  }, []);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[420px] p-0 gap-0 overflow-hidden rounded-xl border border-border">
        {/* Header */}
        <DialogHeader className="px-6 pt-6 pb-4 space-y-2">
          <div className="flex items-center gap-2">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-purple-50 border border-purple-200">
              <Gift className="w-4 h-4 text-purple-600" />
            </div>
            <DialogTitle className="text-lg font-semibold text-foreground">
              使用激活码
            </DialogTitle>
          </div>
          <DialogDescription className="text-sm text-muted-foreground">
            输入激活码即可兑换积分，积分将即时到账
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 pb-6 space-y-5">
          {/* Balance Card */}
          <div className="flex items-center justify-between p-4 rounded-lg bg-surface-muted border border-border/60">
            <div>
              <div className="text-xs font-semibold text-text-faint uppercase tracking-wider">
                当前余额
              </div>
              <div className="mt-1 flex items-baseline gap-1.5">
                <span className="text-2xl font-bold text-foreground tabular-nums">
                  {currentBalance.toLocaleString()}
                </span>
                <span className="text-sm text-muted-foreground">积分</span>
              </div>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-purple-50 border border-purple-200 text-purple-700 text-xs font-medium">
              <Sparkles className="w-3.5 h-3.5" />
              兑换即到账
            </div>
          </div>

          {/* Input */}
          <div className="space-y-2">
            <label className="text-sm font-semibold text-foreground">
              激活码
            </label>
            <div className="flex gap-2">
              <Input
                type="text"
                placeholder="请输入激活码，如 XXXX-XXXX-XXXX"
                value={code}
                onChange={(e) => handleCodeChange(e.target.value)}
                className={cn(
                  "flex-1 h-11 rounded-lg border-border/80 bg-muted/20 text-foreground font-mono text-center tracking-wider",
                  result?.success && "border-green-500 ring-1 ring-green-500/20",
                  result && !result.success && "border-red-500 ring-1 ring-red-500/20"
                )}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && code.trim() && !isSubmitting) {
                    void handleRedeem();
                  }
                }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              激活码支持前缀，示例：PREFIX-XXXX-XXXX-XXXX-XXXX
            </p>
          </div>

          {/* Result */}
          {result && (
            <div
              className={cn(
                "p-4 rounded-lg border",
                result.success
                  ? "bg-green-50 border-green-200"
                  : "bg-red-50 border-red-200"
              )}
            >
              <div className="flex items-start gap-3">
                {result.success ? (
                  <CheckCircle className="w-5 h-5 text-green-600 mt-0.5 shrink-0" />
                ) : (
                  <div className="w-5 h-5 rounded-full bg-red-100 flex items-center justify-center shrink-0">
                    <span className="text-red-600 text-xs font-bold">!</span>
                  </div>
                )}
                <div className="flex-1">
                  <div
                    className={cn(
                      "font-medium",
                      result.success ? "text-green-800" : "text-red-800"
                    )}
                  >
                    {result.success ? "兑换成功" : "兑换失败"}
                  </div>
                  <div
                    className={cn(
                      "text-sm mt-1",
                      result.success ? "text-green-700" : "text-red-700"
                    )}
                  >
                    {result.message}
                  </div>
                  {result.success && (
                    <div className="mt-2 flex items-center gap-2">
                      <span className="text-sm text-green-700">获得积分:</span>
                      <span className="font-bold text-green-800 tabular-nums">
                        +{result.creditsGranted.toLocaleString()}
                      </span>
                      <span className="text-sm text-green-700">
                        · 新余额: {result.newBalance.toLocaleString()}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Submit Button */}
          <Button
            onClick={() => void handleRedeem()}
            disabled={!code.trim() || isSubmitting || result?.success}
            className={cn(
              "w-full h-11 rounded-lg font-semibold text-sm shadow-none disabled:opacity-40",
              result?.success
                ? "bg-green-600 hover:bg-green-700 text-white"
                : "bg-purple-600 hover:bg-purple-700 text-white"
            )}
          >
            {isSubmitting ? (
              <span className="flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                兑换中...
              </span>
            ) : result?.success ? (
              <span className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4" />
                兑换成功
              </span>
            ) : (
              <span className="flex items-center gap-2">
                立即兑换
                <ArrowRight className="w-4 h-4" />
              </span>
            )}
          </Button>

          {/* Tips */}
          <div className="text-center text-xs text-muted-foreground leading-relaxed space-y-1">
            <p>激活码由平台管理员发放，每个激活码仅可使用一次</p>
            <p>兑换后积分即时到账，可用于平台全部消费场景</p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
