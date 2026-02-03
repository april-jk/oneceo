/**
 * User Menu Component - Dropdown menu for user avatar
 */

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Home, Coins, Crown } from "lucide-react";
import { useLocation } from "wouter";

export default function UserMenu() {
  const [, setLocation] = useLocation();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 rounded-full p-0"
        >
          <Avatar className="h-9 w-9">
            <AvatarImage src="https://avatar.vercel.sh/user" alt="User" />
            <AvatarFallback>U</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64 p-0">
        {/* User Info Section */}
        <div className="p-4 border-b border-border">
          <div className="flex items-center gap-3 mb-3">
            <Avatar className="h-12 w-12">
              <AvatarImage src="https://avatar.vercel.sh/user" alt="User" />
              <AvatarFallback>U</AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-sm text-foreground truncate">
                John Doe
              </div>
              <div className="text-xs text-muted-foreground truncate">
                john.doe@example.com
              </div>
            </div>
          </div>

          {/* Credits and Membership Status */}
          <div className="bg-accent/50 rounded-xl p-3 border border-border">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Coins className="w-4 h-4 text-amber-500" />
                <span className="text-sm font-medium text-foreground">Credits</span>
              </div>
              <span className="text-sm font-bold text-foreground">13,639</span>
            </div>
            <div className="flex items-center gap-2">
              <Crown className="w-4 h-4 text-purple-500" />
              <span className="text-xs text-muted-foreground">Pro Member</span>
            </div>
          </div>
        </div>

        {/* Menu Items */}
        <div className="p-1">
          <DropdownMenuItem
            onClick={() => setLocation("/home")}
            className="cursor-pointer py-2.5 px-3 rounded-lg"
          >
            <Home className="w-4 h-4 mr-2 text-muted-foreground" />
            <span className="text-sm">Home</span>
          </DropdownMenuItem>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
