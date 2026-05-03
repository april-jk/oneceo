import { useAuth } from "@/contexts/AuthContext";
import { Diamond } from "lucide-react";

export function CreditBadge() {
  const { credits } = useAuth();

  if (!credits) return null;

  return (
    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-50 border border-amber-200 text-amber-700 text-sm font-medium">
      <Diamond className="w-4 h-4 text-amber-500" />
      <span>{credits.balance.toLocaleString()} 积分</span>
    </div>
  );
}
