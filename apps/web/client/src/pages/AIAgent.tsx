/**
 * Design Philosophy: Swiss International Style + Digital Minimalism
 * AI Agent Landing Page - Centered conversation input with smooth transitions
 */

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Mic, Send, Plus, Sparkles } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useState } from "react";
import { useLocation } from "wouter";
import ConnectorDialog from "@/components/ConnectorDialog";
import WorkspaceLayout from "@/components/WorkspaceLayout";
import { motion } from "framer-motion";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export default function AIAgent() {
  const [, setLocation] = useLocation();
  const [message, setMessage] = useState("");
  const [selectedModel, setSelectedModel] = useState("Agent Pro");

  const handleSend = () => {
    if (message.trim()) {
      // Smooth transition to workspace
      setLocation("/ai-workspace");
    }
  };

  return (
    <WorkspaceLayout>
      <div className="flex items-center justify-center min-h-[calc(100vh-8rem)]">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
          className="w-full max-w-3xl space-y-8"
        >
          {/* Logo and Title */}
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
              <h1 className="text-3xl font-semibold text-foreground tracking-tight">
                AI Agent
              </h1>
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

          {/* Main Input Area */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.4 }}
            className="bg-card border-2 border-border rounded-3xl shadow-lg hover:shadow-xl transition-all duration-200"
          >
            {/* Text Area and Actions - Single Container */}
            <div className="p-4 space-y-3">
              {/* Textarea */}
              <Textarea
                placeholder="Type your message here..."
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                className="border-0 bg-transparent focus-visible:ring-0 text-base resize-none min-h-[100px] px-0 py-0"
                rows={4}
              />

              {/* Bottom Action Bar - No Border Separator */}
              <TooltipProvider>
                <div className="flex items-center justify-between pt-2">
                  {/* Left Side Actions */}
                  <div className="flex items-center gap-1">
                    {/* Add Attachment Button */}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-9 w-9 rounded-xl hover:bg-muted transition-colors"
                        >
                          <Plus className="w-4 h-4 text-muted-foreground" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Add attachment</p>
                      </TooltipContent>
                    </Tooltip>

                    <ConnectorDialog />

                    {/* Model Selection Button */}
                    <DropdownMenu>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-9 px-3 rounded-xl hover:bg-muted transition-colors gap-2"
                            >
                              <Sparkles className="w-4 h-4 text-muted-foreground" />
                              <span className="text-sm text-muted-foreground">{selectedModel}</span>
                            </Button>
                          </DropdownMenuTrigger>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Select AI model</p>
                        </TooltipContent>
                      </Tooltip>
                      <DropdownMenuContent align="start" className="w-40">
                        <DropdownMenuItem onClick={() => setSelectedModel("Agent Lite")}>
                          <div className="flex flex-col">
                            <span className="font-medium">Agent Lite</span>
                            <span className="text-xs text-muted-foreground">Fast & efficient</span>
                          </div>
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setSelectedModel("Agent Pro")}>
                          <div className="flex flex-col">
                            <span className="font-medium">Agent Pro</span>
                            <span className="text-xs text-muted-foreground">Balanced performance</span>
                          </div>
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setSelectedModel("Agent Max")}>
                          <div className="flex flex-col">
                            <span className="font-medium">Agent Max</span>
                            <span className="text-xs text-muted-foreground">Maximum capability</span>
                          </div>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  {/* Right Side Actions */}
                  <div className="flex items-center gap-1">
                    {/* Voice Input Button */}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-9 w-9 rounded-xl hover:bg-muted transition-colors"
                        >
                          <Mic className="w-4 h-4 text-muted-foreground" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Voice input</p>
                      </TooltipContent>
                    </Tooltip>

                    {/* Send Button */}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          onClick={handleSend}
                          disabled={!message.trim()}
                          size="icon"
                          className="h-9 w-9 rounded-xl bg-foreground hover:bg-foreground/90 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <Send className="w-4 h-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Send message</p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                </div>
              </TooltipProvider>
            </div>
          </motion.div>

          {/* Quick Actions */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4, duration: 0.4 }}
            className="grid grid-cols-2 gap-3"
          >
            {[
              "Analyze data",
              "Generate report",
              "Create presentation",
              "Code assistant",
            ].map((action) => (
              <Button
                key={action}
                variant="outline"
                className="h-12 rounded-xl border-border hover:bg-accent hover:border-primary/30 transition-all duration-200 text-sm font-medium"
                onClick={() => setMessage(action)}
              >
                {action}
              </Button>
            ))}
          </motion.div>
        </motion.div>
      </div>

    </WorkspaceLayout>
  );
}
