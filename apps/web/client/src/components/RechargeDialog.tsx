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
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  Diamond,
  Zap,
  CreditCard,
  Smartphone,
  Landmark,
  Check,
  Sparkles,
  ArrowRight,
} from "lucide-react";

interface RechargeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentBalance?: number;
}

interface RechargePackage {
  id: string;
  credits: number;
  price: number;
  label?: string;
  highlight?: boolean;
  discount?: string;
}

const RECHARGE_PACKAGES: RechargePackage[] = [
  { id: "p1", credits: 100, price: 10 },
  { id: "p2", credits: 500, price: 45, label: "常用", discount: "9折" },
  { id: "p3", credits: 1000, price: 80, label: "推荐", highlight: true, discount: "8折" },
  { id: "p4", credits: 5000, price: 350, label: "超值", discount: "7折" },
];

type PaymentMethod = "alipay" | "wechat" | "card" | "bank";

const PAYMENT_METHODS: Array<{
  id: PaymentMethod;
  name: string;
  icon: React.ReactNode;
  description: string;
}> = [
  {
    id: "alipay",
    name: "支付宝",
    icon: <Smartphone className="w-5 h-5" />,
    description: "快捷安全",
  },
  {
    id: "wechat",
    name: "微信支付",
    icon: <Smartphone className="w-5 h-5" />,
    description: "一键支付",
  },
  {
    id: "card",
    name: "银行卡",
    icon: <CreditCard className="w-5 h-5" />,
    description: "信用卡/借记卡",
  },
  {
    id: "bank",
    name: "对公转账",
    icon: <Landmark className="w-5 h-5" />,
    description: "企业用户",
  },
];

export function RechargeDialog({
  open,
  onOpenChange,
  currentBalance = 0,
}: RechargeDialogProps) {
  const [selectedPackage, setSelectedPackage] = useState<string | null>("p3");
  const [customAmount, setCustomAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("alipay");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const selectedPkg = RECHARGE_PACKAGES.find((p) => p.id === selectedPackage);

  const finalCredits = selectedPkg
    ? selectedPkg.credits
    : customAmount
      ? parseInt(customAmount, 10) || 0
      : 0;

  const finalPrice = selectedPkg
    ? selectedPkg.price
    : customAmount
      ? (parseInt(customAmount, 10) || 0) * 0.1
      : 0;

  const handlePackageSelect = useCallback((pkg: RechargePackage) => {
    setSelectedPackage(pkg.id);
    setCustomAmount("");
  }, []);

  const handleCustomAmountChange = useCallback(
    (value: string) => {
      const numeric = value.replace(/\D/g, "");
      if (numeric === "" || parseInt(numeric, 10) <= 999999) {
        setCustomAmount(numeric);
        if (numeric) {
          setSelectedPackage(null);
        }
      }
    },
    []
  );

  const handleRecharge = useCallback(async () => {
    if (finalCredits <= 0) {
      toast.error("请选择或输入充值金额");
      return;
    }
    setIsSubmitting(true);
    await new Promise((resolve) => setTimeout(resolve, 800));
    setIsSubmitting(false);
    toast.success("充值接口即将上线，演示模式下已模拟成功", {
      description: `模拟充值: ${finalCredits} 积分 · ¥${finalPrice.toFixed(2)} · ${PAYMENT_METHODS.find((p) => p.id === paymentMethod)?.name}`,
    });
    onOpenChange(false);
  }, [finalCredits, finalPrice, paymentMethod, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px] p-0 gap-0 overflow-hidden rounded-xl border border-border">
        {/* Header */}
        <DialogHeader className="px-6 pt-6 pb-4 space-y-2">
          <div className="flex items-center gap-2">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-amber-50 border border-amber-200">
              <Diamond className="w-4 h-4 text-amber-600" />
            </div>
            <DialogTitle className="text-lg font-semibold text-foreground">
              充值积分
            </DialogTitle>
          </div>
          <DialogDescription className="text-sm text-muted-foreground">
            选择积分套餐或直接输入自定义金额完成充值
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 pb-6 space-y-6">
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
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-50 border border-amber-200 text-amber-700 text-xs font-medium">
              <Sparkles className="w-3.5 h-3.5" />
              1 积分 = ¥0.10
            </div>
          </div>

          {/* Package Grid */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-foreground">
                选择套餐
              </span>
              {selectedPkg?.discount && (
                <Badge
                  variant="outline"
                  className="text-xs border-amber-200 text-amber-700 bg-amber-50"
                >
                  {selectedPkg.discount}
                </Badge>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              {RECHARGE_PACKAGES.map((pkg) => {
                const isSelected = selectedPackage === pkg.id;
                return (
                  <button
                    key={pkg.id}
                    type="button"
                    onClick={() => handlePackageSelect(pkg)}
                    className={cn(
                      "relative flex flex-col items-start p-3.5 rounded-lg border text-left transition-all duration-150",
                      isSelected
                        ? "border-[#0969da] bg-[#0969da]/[0.04] shadow-[0_0_0_1px_#0969da]"
                        : pkg.highlight
                          ? "border-amber-200 bg-amber-50/40 hover:border-amber-300"
                          : "border-border bg-surface hover:border-[#0969da]/40 hover:bg-[#0969da]/[0.02]"
                    )}
                  >
                    {pkg.label && (
                      <span
                        className={cn(
                          "absolute top-2 right-2 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded",
                          pkg.highlight
                            ? "bg-amber-100 text-amber-700"
                            : "bg-muted text-muted-foreground"
                        )}
                      >
                        {pkg.label}
                      </span>
                    )}
                    <div className="flex items-center gap-1.5 mb-1">
                      <Zap
                        className={cn(
                          "w-4 h-4",
                          isSelected ? "text-[#0969da]" : "text-amber-500"
                        )}
                      />
                      <span
                        className={cn(
                          "text-base font-bold tabular-nums",
                          isSelected ? "text-[#0969da]" : "text-foreground"
                        )}
                      >
                        {pkg.credits.toLocaleString()}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        积分
                      </span>
                    </div>
                    <div className="flex items-baseline gap-1">
                      <span className="text-xs text-muted-foreground">¥</span>
                      <span
                        className={cn(
                          "text-lg font-bold tabular-nums",
                          isSelected ? "text-[#0969da]" : "text-foreground"
                        )}
                      >
                        {pkg.price}
                      </span>
                      {pkg.discount && (
                        <span className="text-[10px] text-muted-foreground line-through ml-1">
                          ¥{(pkg.credits * 0.1).toFixed(0)}
                        </span>
                      )}
                    </div>
                    {isSelected && (
                      <div className="absolute bottom-2 right-2 flex items-center justify-center w-5 h-5 rounded-full bg-[#0969da]">
                        <Check className="w-3 h-3 text-white" />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Custom Amount */}
          <div className="space-y-2">
            <span className="text-sm font-semibold text-foreground">
              自定义金额
            </span>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  ¥
                </span>
                <Input
                  type="text"
                  inputMode="numeric"
                  placeholder="输入自定义金额"
                  value={customAmount}
                  onChange={(e) => handleCustomAmountChange(e.target.value)}
                  className={cn(
                    "pl-7 h-10 rounded-lg border-border/80 bg-muted/20 text-foreground",
                    customAmount &&
                      !selectedPackage &&
                      "border-[#0969da] ring-1 ring-[#0969da]/20"
                  )}
                />
              </div>
              {customAmount && !selectedPackage && (
                <div className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#0969da]/[0.04] border border-[#0969da]/20 text-sm">
                  <Diamond className="w-3.5 h-3.5 text-[#0969da]" />
                  <span className="font-semibold text-[#0969da] tabular-nums">
                    {(parseInt(customAmount, 10) * 10).toLocaleString()}
                  </span>
                  <span className="text-xs text-[#0969da]/70">积分</span>
                </div>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              自定义金额按 1 元 = 10 积分换算，无折扣
            </p>
          </div>

          {/* Payment Methods */}
          <div className="space-y-2">
            <span className="text-sm font-semibold text-foreground">
              支付方式
            </span>
            <div className="grid grid-cols-2 gap-2">
              {PAYMENT_METHODS.map((method) => {
                const isActive = paymentMethod === method.id;
                return (
                  <button
                    key={method.id}
                    type="button"
                    onClick={() => setPaymentMethod(method.id)}
                    className={cn(
                      "flex items-center gap-2.5 p-3 rounded-lg border text-left transition-all duration-150",
                      isActive
                        ? "border-[#0969da] bg-[#0969da]/[0.04] shadow-[0_0_0_1px_#0969da]"
                        : "border-border bg-surface hover:border-[#0969da]/30"
                    )}
                  >
                    <div
                      className={cn(
                        "flex items-center justify-center w-8 h-8 rounded-md shrink-0",
                        isActive
                          ? "bg-[#0969da]/10 text-[#0969da]"
                          : "bg-muted text-muted-foreground"
                      )}
                    >
                      {method.icon}
                    </div>
                    <div className="min-w-0">
                      <div
                        className={cn(
                          "text-sm font-medium",
                          isActive ? "text-[#0969da]" : "text-foreground"
                        )}
                      >
                        {method.name}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {method.description}
                      </div>
                    </div>
                    {isActive && (
                      <Check className="w-4 h-4 text-[#0969da] ml-auto shrink-0" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Divider */}
          <div className="border-t border-border/60 pt-4">
            <div className="flex items-center justify-between mb-4">
              <div className="space-y-0.5">
                <div className="text-sm text-muted-foreground">
                  本次充值
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="text-2xl font-bold text-foreground tabular-nums">
                    {finalCredits > 0 ? finalCredits.toLocaleString() : "—"}
                  </span>
                  <span className="text-sm text-muted-foreground">积分</span>
                </div>
              </div>
              <div className="text-right space-y-0.5">
                <div className="text-sm text-muted-foreground">应付金额</div>
                <div className="flex items-baseline gap-0.5 justify-end">
                  <span className="text-sm text-foreground">¥</span>
                  <span className="text-2xl font-bold text-foreground tabular-nums">
                    {finalPrice > 0 ? finalPrice.toFixed(2) : "—"}
                  </span>
                </div>
              </div>
            </div>

            <Button
              onClick={() => void handleRecharge()}
              disabled={finalCredits <= 0 || isSubmitting}
              className="w-full h-11 rounded-lg bg-[#0969da] hover:bg-[#0550ae] text-white font-semibold text-sm shadow-none disabled:opacity-40"
            >
              {isSubmitting ? (
                <span className="flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  处理中...
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  确认充值
                  <ArrowRight className="w-4 h-4" />
                </span>
              )}
            </Button>

            <p className="mt-3 text-center text-xs text-muted-foreground leading-relaxed">
              充值后积分即时到账，可用于平台全部消费场景。
              <br />
              企业用户如需开具发票，请选择"对公转账"并联系客服。
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
