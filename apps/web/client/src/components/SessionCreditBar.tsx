import { useState, useEffect, useCallback } from "react";
import { Diamond, Flame } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

interface SessionUsage {
  totalCredits: number;
}

export function SessionCreditBar({ sessionId, refreshKey }: { sessionId: string; refreshKey?: string | number | null }) {
  const { credits, refreshCredits } = useAuth();
  const [usage, setUsage] = useState<SessionUsage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchUsage = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/billing/session/${encodeURIComponent(sessionId)}/usage`, {
        credentials: "include",
      });
      if (response.ok) {
        const data = await response.json();
        setUsage(data);
        setError(null);
        void refreshCredits();
      } else {
        setError("加载失败");
      }
    } catch {
      setError("加载失败");
    } finally {
      setLoading(false);
    }
  }, [refreshCredits, sessionId]);

  useEffect(() => {
    fetchUsage();
  }, [fetchUsage, refreshKey]);

  if (loading && !usage) return null;
  if (error || !usage) return null;
  if (usage.totalCredits === 0) return null;

  return (
    <div className="flex items-center justify-between px-4 py-2 bg-muted/50 border-y text-xs text-muted-foreground">
      <div className="flex items-center gap-4">
        <span className="flex items-center gap-1">
          <Flame className="w-3 h-3" />
          本次已消耗: {usage.totalCredits} 积分
        </span>
      </div>
      <span className="flex items-center gap-1">
        <Diamond className="w-3 h-3" />
        剩余: {(credits?.balance ?? 0).toLocaleString()} 积分
      </span>
    </div>
  );
}
