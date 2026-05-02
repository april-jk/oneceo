import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Diamond, ArrowDown, MessageSquare, RefreshCw, Wallet } from "lucide-react";
import { RechargeDialog } from "./RechargeDialog";

interface SessionConsumptionRecord {
  id: string;
  sessionId: string;
  sessionTitle: string;
  totalCredits: number;
  callCount: number;
  lastUsedAt: string;
}

export function BillingSettingsPanel({ onClose }: { onClose?: () => void }) {
  const { credits, refreshCredits } = useAuth();
  const [, setLocation] = useLocation();
  const [records, setRecords] = useState<SessionConsumptionRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);
  const [rechargeOpen, setRechargeOpen] = useState(false);

  const fetchTransactions = useCallback(async (pageNum: number) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/billing/transactions?page=${pageNum}&limit=20`, {
        credentials: 'include',
      });
      if (response.ok) {
        const data = await response.json();
        if (pageNum === 1) {
          setRecords(data.items);
        } else {
          setRecords((prev) => [...prev, ...data.items]);
        }
        setHasMore(data.items.length === 20 && data.total > pageNum * 20);
      }
    } catch (error) {
      console.error('获取交易记录失败:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshCredits();
    fetchTransactions(1);
  }, [fetchTransactions, refreshCredits]);

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString('zh-CN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const openSession = useCallback((sessionId: string) => {
    if (!sessionId) return;
    setLocation(`/session/${encodeURIComponent(sessionId)}?view=history`);
    onClose?.();
  }, [onClose, setLocation]);

  return (
    <div className="space-y-6">
      {/* 余额卡片 */}
      <div className="p-6 rounded-lg bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200">
        <div className="text-sm text-amber-700 mb-1">当前余额</div>
        <div className="text-3xl font-bold text-amber-800 flex items-center gap-2">
          <Diamond className="w-8 h-8" />
          {credits?.balance?.toLocaleString() || 0}
          <span className="text-base font-normal text-amber-600">积分</span>
        </div>
        <div className="mt-4 flex gap-4 text-sm text-amber-600">
          <span>累计获得: {credits?.totalEarned || 0}</span>
          <span>累计消费: {credits?.totalConsumed || 0}</span>
        </div>
      </div>

      {/* 充值入口 */}
      <div className="flex gap-3">
        <Button
          onClick={() => setRechargeOpen(true)}
          className="h-10 px-4 rounded-lg bg-[#0969da] hover:bg-[#0550ae] text-white font-semibold text-sm shadow-none"
        >
          <Wallet className="mr-2 h-4 w-4" />
          充值积分
        </Button>
      </div>

      {/* 消费记录列表 */}
      <div>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="text-lg font-semibold">消费记录</h3>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setPage(1);
              void refreshCredits();
              void fetchTransactions(1);
            }}
            disabled={loading}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            刷新
          </Button>
        </div>
        <div className="space-y-2">
          {records.length === 0 && !loading && (
            <div className="text-center text-muted-foreground py-8">
              暂无消费记录
            </div>
          )}
          {records.map((record) => (
            <div
              key={record.id}
              className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full flex items-center justify-center bg-red-100 text-red-600">
                  <ArrowDown className="w-4 h-4" />
                </div>
                <div>
                  <button
                    type="button"
                    className="text-left font-medium hover:text-primary hover:underline underline-offset-4 transition-colors"
                    onClick={() => openSession(record.sessionId)}
                  >
                    {record.sessionTitle || "未命名会话"}
                  </button>
                  <div className="text-xs text-muted-foreground">
                    {formatDate(record.lastUsedAt)} · 点击查看会话
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 font-mono font-medium text-red-600">
                <MessageSquare className="h-4 w-4" />
                -{record.totalCredits}
              </div>
            </div>
          ))}
        </div>

        {hasMore && (
          <Button
            variant="ghost"
            className="w-full mt-4"
            onClick={() => {
              const nextPage = page + 1;
              setPage(nextPage);
              fetchTransactions(nextPage);
            }}
            disabled={loading}
          >
            {loading ? "加载中..." : "加载更多"}
          </Button>
        )}
      </div>

      <RechargeDialog
        open={rechargeOpen}
        onOpenChange={setRechargeOpen}
        currentBalance={credits?.balance || 0}
      />
    </div>
  );
}
