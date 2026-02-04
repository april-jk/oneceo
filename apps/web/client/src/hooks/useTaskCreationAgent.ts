/**
 * 任务创建智能体 Hook
 * 
 * 管理与任务创建 WebSocket 的连接和消息交互
 */

import { useState, useEffect, useCallback, useRef } from 'react';

export interface AgentMessage {
  type: 'agent_message' | 'clarification_request' | 'plan_generated' | 'error';
  content?: string;
  agent?: string;
  metadata?: any;
  question?: string;
  options?: string[];
  plan?: any;
  message?: string;
}

export interface UseTaskCreationAgentOptions {
  onPlanGenerated?: (plan: any) => void;
  onError?: (error: string) => void;
}

export function useTaskCreationAgent(options?: UseTaskCreationAgentOptions) {
  const WELCOME_MESSAGE = '欢迎使用 Altus 任务创建助手！请描述您想要创建的任务。';
  const [isConnected, setIsConnected] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [currentQuestion, setCurrentQuestion] = useState<{
    question: string;
    options?: string[];
  } | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const onPlanGeneratedRef = useRef(options?.onPlanGenerated);
  const onErrorRef = useRef(options?.onError);

  useEffect(() => {
    onPlanGeneratedRef.current = options?.onPlanGenerated;
    onErrorRef.current = options?.onError;
  }, [options?.onPlanGenerated, options?.onError]);

  // 连接 WebSocket
  const connect = useCallback(() => {
    if (
      wsRef.current?.readyState === WebSocket.OPEN ||
      wsRef.current?.readyState === WebSocket.CONNECTING
    ) {
      return;
    }

    const ws = new WebSocket('ws://localhost:4000/ws/task-creation');

    ws.onopen = () => {
      console.log('[TaskCreationAgent] WebSocket 连接成功');
      setIsConnected(true);
    };

    ws.onmessage = (event) => {
      try {
        const message: AgentMessage = JSON.parse(event.data);
        console.log('[TaskCreationAgent] 收到消息:', message);

        setMessages((prev) => {
          const lastMessage = prev[prev.length - 1];
          const isDuplicateWelcome =
            message.type === 'agent_message' &&
            message.agent === 'system' &&
            message.content === WELCOME_MESSAGE &&
            lastMessage?.type === 'agent_message' &&
            lastMessage?.agent === 'system' &&
            lastMessage?.content === WELCOME_MESSAGE;

          return isDuplicateWelcome ? prev : [...prev, message];
        });

        switch (message.type) {
          case 'agent_message':
            // 显示 Agent 消息
            break;

          case 'clarification_request':
            // 显示澄清问题
            if (message.question) {
              setCurrentQuestion({
                question: message.question,
                options: message.options,
              });
            }
            break;

          case 'plan_generated':
            // 计划生成完成
            setIsProcessing(false);
            if (message.plan && onPlanGeneratedRef.current) {
              onPlanGeneratedRef.current(message.plan);
            }
            break;

          case 'error':
            // 错误处理
            setIsProcessing(false);
            if (message.message && onErrorRef.current) {
              onErrorRef.current(message.message);
            }
            break;
        }
      } catch (error) {
        console.error('[TaskCreationAgent] 解析消息失败:', error);
      }
    };

    ws.onerror = (error) => {
      console.error('[TaskCreationAgent] WebSocket 错误:', error);
      setIsConnected(false);
    };

    ws.onclose = () => {
      console.log('[TaskCreationAgent] WebSocket 连接关闭');
      setIsConnected(false);
    };

    wsRef.current = ws;
  }, []);

  // 断开连接
  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setIsConnected(false);
  }, []);

  // 发送用户输入
  const sendUserInput = useCallback((input: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.error('[TaskCreationAgent] WebSocket 未连接');
      return;
    }

    setIsProcessing(true);
    setMessages([]);
    setCurrentQuestion(null);

    wsRef.current.send(
      JSON.stringify({
        type: 'user_input',
        content: input,
      })
    );
  }, []);

  // 回答澄清问题
  const answerQuestion = useCallback((answer: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.error('[TaskCreationAgent] WebSocket 未连接');
      return;
    }

    wsRef.current.send(
      JSON.stringify({
        type: 'user_response',
        content: answer,
      })
    );

    setCurrentQuestion(null);
  }, []);

  // 清空消息
  const clearMessages = useCallback(() => {
    setMessages([]);
    setCurrentQuestion(null);
  }, []);

  // 自动连接
  useEffect(() => {
    connect();

    return () => {
      disconnect();
    };
  }, [connect, disconnect]);

  return {
    isConnected,
    isProcessing,
    messages,
    currentQuestion,
    sendUserInput,
    answerQuestion,
    clearMessages,
    connect,
    disconnect,
  };
}
