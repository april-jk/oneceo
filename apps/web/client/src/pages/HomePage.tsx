import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Mic, Plug, Send, Plus, Sparkles } from "lucide-react";
import { useState } from "react";
import { useLocation } from "wouter";
import ConnectorDialog from "@/components/ConnectorDialog";
import { motion } from "framer-motion";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import UserMenu from "@/components/UserMenu";

export default function HomePage() {
  const [, setLocation] = useLocation();
  const [message, setMessage] = useState("");
  const [showConnector, setShowConnector] = useState(false);
  const [selectedModel, setSelectedModel] = useState("Agent Pro");

  const goToNewTask = (input: string) => {
    const value = input.trim();
    if (!value) return;
    setLocation(`/new-task?q=${encodeURIComponent(value)}`);
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <nav className="border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
        <div className="container mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/logo.png" alt="oneceo" className="w-9 h-9 rounded-xl" />
            <div className="flex flex-col">
              <span className="text-sm font-semibold text-foreground leading-tight">oneceo</span>
              <span className="text-xs text-muted-foreground leading-tight">AI Agent Platform</span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <UserMenu />
          </div>
        </div>
      </nav>

      <div className="flex-1 flex items-center justify-center p-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
          className="w-full max-w-3xl space-y-8"
        >
          <div className="text-center space-y-4">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.1, duration: 0.4 }}
              className="flex items-center justify-center gap-3"
            >
              <div className="w-12 h-12 bg-foreground rounded-2xl flex items-center justify-center shadow-lg">
                <span className="text-background font-bold text-xl">M</span>
              </div>
              <h1 className="text-3xl font-semibold text-foreground tracking-tight">AI Agent</h1>
            </motion.div>
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.2, duration: 0.4 }}
              className="text-muted-foreground text-lg"
            >
              What can I help you with today?
            </motion.p>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.4 }}
            className="bg-card border-2 border-border rounded-3xl shadow-lg hover:shadow-xl transition-all duration-200"
          >
            <div className="p-4 space-y-3">
              <Textarea
                placeholder="Type your message here..."
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    goToNewTask(message);
                  }
                }}
                className="border-0 bg-transparent focus-visible:ring-0 text-base resize-none min-h-[100px] px-0 py-0"
                rows={4}
              />

              <TooltipProvider>
                <div className="flex items-center justify-between pt-2">
                  <div className="flex items-center gap-1">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-9 w-9 rounded-xl hover:bg-muted">
                          <Plus className="w-4 h-4 text-muted-foreground" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent><p>Add attachment</p></TooltipContent>
                    </Tooltip>

                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-9 w-9 rounded-xl hover:bg-muted"
                          onClick={() => setShowConnector(true)}
                        >
                          <Plug className="w-4 h-4 text-muted-foreground" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent><p>Connector</p></TooltipContent>
                    </Tooltip>

                    <DropdownMenu>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-9 px-3 rounded-xl gap-2 hover:bg-muted">
                              <Sparkles className="w-4 h-4 text-muted-foreground" />
                              <span className="text-sm text-muted-foreground">{selectedModel}</span>
                            </Button>
                          </DropdownMenuTrigger>
                        </TooltipTrigger>
                        <TooltipContent><p>Select AI model</p></TooltipContent>
                      </Tooltip>
                      <DropdownMenuContent align="start" className="w-40">
                        <DropdownMenuItem onClick={() => setSelectedModel("Agent Lite")}>Agent Lite</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setSelectedModel("Agent Pro")}>Agent Pro</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setSelectedModel("Agent Max")}>Agent Max</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  <div className="flex items-center gap-1">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-9 w-9 rounded-xl hover:bg-muted">
                          <Mic className="w-4 h-4 text-muted-foreground" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent><p>Voice input</p></TooltipContent>
                    </Tooltip>

                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          onClick={() => goToNewTask(message)}
                          disabled={!message.trim()}
                          size="icon"
                          className="h-9 w-9 rounded-xl bg-foreground hover:bg-foreground/90 disabled:opacity-50"
                        >
                          <Send className="w-4 h-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent><p>Send message</p></TooltipContent>
                    </Tooltip>
                  </div>
                </div>
              </TooltipProvider>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4, duration: 0.4 }}
            className="grid grid-cols-2 gap-3"
          >
            {[
              "我想做一个Python开发行业的市场调研",
              "帮我分析竞争对手的产品策略",
              "创建一个新产品的营销计划",
              "生成季度业务报告",
            ].map((action) => (
              <Button
                key={action}
                variant="outline"
                className="h-auto py-3 px-4 rounded-xl border-border hover:bg-accent hover:border-primary/30 text-sm font-medium text-left whitespace-normal"
                onClick={() => goToNewTask(action)}
              >
                {action}
              </Button>
            ))}
          </motion.div>
        </motion.div>
      </div>

      <ConnectorDialog open={showConnector} onOpenChange={setShowConnector} />
    </div>
  );
}

