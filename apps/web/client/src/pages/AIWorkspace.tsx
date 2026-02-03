/**
 * Design Philosophy: Swiss International Style + Digital Minimalism
 * AI Workspace with sidebar and main chat area
 */

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { motion } from "framer-motion";
import {
  FileText,
  Mic,
  MoreVertical,
  PlusCircle,
  Send,
  User,
} from "lucide-react";
import { useState } from "react";

export default function AIWorkspace() {
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState([
    {
      id: 1,
      role: "assistant",
      content: "Hello! How can I assist you today?",
      timestamp: new Date(),
    },
  ]);

  const conversations = [
    { id: 1, title: "Data Analysis Project", timestamp: "2 hours ago" },
    { id: 2, title: "Code Review Request", timestamp: "Yesterday" },
    { id: 3, title: "Report Generation", timestamp: "2 days ago" },
  ];

  const handleSend = () => {
    if (message.trim()) {
      setMessages([
        ...messages,
        {
          id: messages.length + 1,
          role: "user",
          content: message,
          timestamp: new Date(),
        },
      ]);
      setMessage("");

      // Simulate AI response
      setTimeout(() => {
        setMessages((prev) => [
          ...prev,
          {
            id: prev.length + 1,
            role: "assistant",
            content: "I'm processing your request...",
            timestamp: new Date(),
          },
        ]);
      }, 1000);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
      className="min-h-screen bg-background flex"
    >
      {/* Left Sidebar */}
      <motion.aside
        initial={{ x: -240, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="w-60 bg-card border-r border-border flex flex-col shadow-sm"
      >
        {/* Header */}
        <div className="h-14 flex items-center justify-between px-4 border-b border-border">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-foreground rounded-xl flex items-center justify-center">
              <span className="text-background font-bold text-sm">M</span>
            </div>
            <span className="font-semibold text-card-foreground">AI Agent</span>
          </div>
        </div>

        {/* New Conversation */}
        <div className="p-3">
          <Button className="w-full gap-2 rounded-xl bg-foreground hover:bg-foreground/90 text-background" variant="default">
            <PlusCircle className="w-4 h-4" />
            New Chat
          </Button>
        </div>

        <Separator />

        {/* Conversations List */}
        <ScrollArea className="flex-1">
          <div className="p-3 space-y-1">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-3 mb-2">
              Recent Conversations
            </h3>
            {conversations.map((conv) => (
              <Button
                key={conv.id}
                variant="ghost"
                className="w-full justify-start h-auto py-3 px-3 rounded-xl hover:bg-accent transition-colors"
              >
                <div className="flex items-start gap-3 w-full">
                  <FileText className="w-4 h-4 mt-0.5 flex-shrink-0 text-muted-foreground" />
                  <div className="flex-1 min-w-0 text-left">
                    <p className="text-sm font-medium text-card-foreground truncate">
                      {conv.title}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {conv.timestamp}
                    </p>
                  </div>
                </div>
              </Button>
            ))}
          </div>
        </ScrollArea>
      </motion.aside>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col">
        {/* Top Bar */}
        <motion.header
          initial={{ y: -56, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.4, delay: 0.1, ease: "easeOut" }}
          className="h-14 bg-card border-b border-border flex items-center justify-between px-6 shadow-sm"
        >
          <h2 className="text-base font-semibold text-card-foreground">
            Current Conversation
          </h2>
          <Button variant="ghost" size="icon" className="h-9 w-9 rounded-xl">
            <MoreVertical className="w-4 h-4" />
          </Button>
        </motion.header>

        {/* Messages Area */}
        <ScrollArea className="flex-1 p-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.2 }}
            className="max-w-4xl mx-auto space-y-6"
          >
            {messages.map((msg, index) => (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: index * 0.05 }}
                className={`flex gap-4 ${
                  msg.role === "user" ? "flex-row-reverse" : "flex-row"
                }`}
              >
                <div
                  className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                    msg.role === "user"
                      ? "bg-foreground"
                      : "bg-secondary border border-border"
                  }`}
                >
                  {msg.role === "user" ? (
                    <User className="w-5 h-5 text-background" />
                  ) : (
                    <span className="text-foreground font-bold text-sm">M</span>
                  )}
                </div>
                <div
                  className={`flex-1 max-w-2xl ${
                    msg.role === "user" ? "text-right" : "text-left"
                  }`}
                >
                  <div
                    className={`inline-block p-4 rounded-2xl ${
                      msg.role === "user"
                        ? "bg-foreground text-background"
                        : "bg-card border border-border"
                    }`}
                  >
                    <p className="text-sm leading-relaxed">{msg.content}</p>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2 px-1">
                    {msg.timestamp.toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
              </motion.div>
            ))}
          </motion.div>
        </ScrollArea>

        {/* Input Area */}
        <motion.div
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.4, delay: 0.3, ease: "easeOut" }}
          className="border-t border-border bg-card p-4"
        >
          <div className="max-w-4xl mx-auto">
            <div className="bg-background border border-border rounded-2xl p-2 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-end gap-2">
                <div className="flex-1 min-w-0">
                  <Input
                    placeholder="Type your message..."
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    onKeyPress={handleKeyPress}
                    className="border-0 bg-transparent focus-visible:ring-0 text-base h-10 px-3"
                  />
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-10 w-10 rounded-xl flex-shrink-0 hover:bg-primary/10"
                >
                  <Mic className="w-5 h-5 text-muted-foreground" />
                </Button>
                <Button
                  onClick={handleSend}
                  disabled={!message.trim()}
                  className="h-10 w-10 rounded-xl flex-shrink-0 bg-foreground hover:bg-foreground/90 transition-all disabled:opacity-50"
                  size="icon"
                >
                  <Send className="w-5 h-5" />
                </Button>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}
