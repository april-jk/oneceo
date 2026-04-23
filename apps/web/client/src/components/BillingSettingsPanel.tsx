import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Diamond, ArrowDown, ArrowUp, Settings } from "lucide-react";

interface Transaction {
  id: string;
  type: string;
  amount: number;
  balanceAfter: number;
  description: string;
  createdAt: string;
}

export function BillingSettingsPanel() {
  const { credits } = useAuth();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);

  const fetchTransactions = async (pageNum: number) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/billing/transactions?page=${pageNum}&limit=20`, {
        credentials: 'include',
      });
      if (response.ok) {
        const data = await response.json();
        if (pageNum === 1) {
          setTransactions(data.items);
        } else {
          setTransactions((prev) => [...prev, ...data.items]);
        }
        setHasMore(data.items.length === 20 && data.total > pageNum * 20);
      }
    } catch (error) {
      console.error('获取交易记录失败:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTransactions(1);
  }, []);

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString('zh-CN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

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

      {/* 充值入口（预留） */}
      <div className="flex gap-3">
        <Button disabled>
          <span className="mr-2">+</span>
          充值积分（即将上线）
        </Button>
      </div>

      {/* 消费记录列表 */}
      <div>
        <h3 className="text-lg font-semibold mb-4">消费记录</h3>
        <div className="space-y-2">
          {transactions.length === 0 && !loading && (
            <div className="text-center text-muted-foreground py-8">
              暂无消费记录
            </div>
          )}
          {transactions.map((tx) => (
            <div
              key={tx.id}
              className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center ${
                    tx.type === "consume"
                      ? "bg-red-100 text-red-600"
                      : tx.type === "recharge"
                      ? "bg-green-100 text-green-600"
                      : "bg-blue-100 text-blue-600"
                  }`}
                >
                  {tx.type === "consume" ? (
                    <ArrowDown className="w-4 h-4" />
                  ) : tx.type === "recharge" ? (
                    <ArrowUp className="w-4 h-4" />
                  ) : (
                    <Settings className="w-4 h-4" />
                  )}
                </div>
                <div>
                  <div className="font-medium">{tx.description}</div>
                  <div className="text-xs text-muted-foreground">
                    {formatDate(tx.createdAt)}
                  </div>
                </div>
              </div>
              <div
                className={`font-mono font-medium ${
                  tx.amount < 0 ? "text-red-600" : "text-green-600"
                }`}
              >
                {tx.amount > 0 ? "+" : ""}
                {tx.amount}
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
    </div>
  );
}
