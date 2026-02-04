/**
 * 任务创建对话组件
 * 
 * 显示与任务创建智能体的对话流程
 */

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Loader2, Send, CheckCircle2 } from "lucide-react";
import { useState } from "react";
import { useTaskCreationAgent, type AgentMessage } from "@/hooks/useTaskCreationAgent";
import { motion, AnimatePresence } from "framer-motion";

interface TaskCreationChatProps {
  onPlanGenerated?: (plan: any) => void;
}

export default function TaskCreationChat({ onPlanGenerated }: TaskCreationChatProps) {
  const [userAnswer, setUserAnswer] = useState("");

  const {
    isConnected,
    isProcessing,
    messages,
    currentQuestion,
    sendUserInput,
    answerQuestion,
  } = useTaskCreationAgent({
    onPlanGenerated,
    onError: (error) => {
      console.error("任务创建失败:", error);
    },
  });

  const handleAnswerSubmit = () => {
    if (userAnswer.trim()) {
      answerQuestion(userAnswer);
      setUserAnswer("");
    }
  };

  return (
    <div className="space-y-4">
      {/* 连接状态 */}
      {!isConnected && (
        <Card className="p-4 bg-yellow-50 border-yellow-200">
          <div className="flex items-center gap-2 text-yellow-800">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">正在连接智能体...</span>
          </div>
        </Card>
      )}

      {/* 消息列表 */}
      <div className="space-y-3 max-h-[400px] overflow-y-auto">
        <AnimatePresence>
          {messages.map((message, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.3 }}
            >
              <MessageCard message={message} />
            </motion.div>
          ))}
        </AnimatePresence>

        {/* 处理中指示器 */}
        {isProcessing && !currentQuestion && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex items-center gap-2 text-muted-foreground"
          >
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">智能体正在处理...</span>
          </motion.div>
        )}
      </div>

      {/* 澄清问题输入 */}
      {currentQuestion && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-3"
        >
          <Card className="p-4 bg-blue-50 border-blue-200">
            <p className="text-sm font-medium text-blue-900 mb-3">
              {currentQuestion.question}
            </p>

            {/* 如果有选项，显示按钮 */}
            {currentQuestion.options && currentQuestion.options.length > 0 ? (
              <div className="grid grid-cols-2 gap-2">
                {currentQuestion.options.map((option, index) => (
                  <Button
                    key={index}
                    variant="outline"
                    className="h-auto py-3 text-sm"
                    onClick={() => answerQuestion(option)}
                  >
                    {option}
                  </Button>
                ))}
              </div>
            ) : (
              // 否则显示输入框
              <div className="flex gap-2">
                <Input
                  value={userAnswer}
                  onChange={(e) => setUserAnswer(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      handleAnswerSubmit();
                    }
                  }}
                  placeholder="请输入您的回答..."
                  className="flex-1"
                />
                <Button
                  onClick={handleAnswerSubmit}
                  disabled={!userAnswer.trim()}
                  size="icon"
                >
                  <Send className="w-4 h-4" />
                </Button>
              </div>
            )}
          </Card>
        </motion.div>
      )}
    </div>
  );
}

/**
 * 消息卡片组件
 */
function MessageCard({ message }: { message: AgentMessage }) {
  const getAgentName = (agent?: string) => {
    const nameMap: Record<string, string> = {
      system: "系统",
      intent_recognition: "意图识别",
      planning: "任务规划",
      execution_plan: "执行计划",
    };
    return agent ? nameMap[agent] || agent : "智能体";
  };

  const getIcon = (type: string) => {
    switch (type) {
      case "plan_generated":
        return <CheckCircle2 className="w-4 h-4 text-green-600" />;
      case "error":
        return <span className="text-red-600">❌</span>;
      default:
        return <span className="text-blue-600">🤖</span>;
    }
  };

  if (message.type === "error") {
    return (
      <Card className="p-4 bg-red-50 border-red-200">
        <div className="flex items-start gap-3">
          {getIcon(message.type)}
          <div className="flex-1">
            <p className="text-sm font-medium text-red-900">错误</p>
            <p className="text-sm text-red-700 mt-1">{message.message}</p>
          </div>
        </div>
      </Card>
    );
  }

  if (message.type === "plan_generated") {
    return (
      <Card className="p-4 bg-green-50 border-green-200">
        <div className="flex items-start gap-3">
          {getIcon(message.type)}
          <div className="flex-1">
            <p className="text-sm font-medium text-green-900">执行计划已生成</p>
            <p className="text-sm text-green-700 mt-1">
              项目：{message.plan?.project?.title || "未命名项目"}
            </p>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        {getIcon(message.type)}
        <div className="flex-1">
          <p className="text-sm font-medium text-foreground">
            {getAgentName(message.agent)}
          </p>
          <p className="text-sm text-muted-foreground mt-1">{message.content}</p>
        </div>
      </div>
    </Card>
  );
}
