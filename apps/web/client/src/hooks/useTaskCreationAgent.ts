/**
 * 任务创建智能体 Hook
 * 
 * 管理与任务创建 WebSocket 的连接和消息交互
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useLocation } from 'wouter';

export interface AgentMessage {
  type: 'agent_message' | 'status_update' | 'clarification_request' | 'plan_generated' | 'error' | 'user_input' | 'user_response';
  sessionId?: string;
  content?: string;
  agent?: string;
  stage?: 'collecting' | 'clarifying' | 'planning' | 'executing' | 'completed' | 'failed';
  tone?: 'system' | 'intent' | 'planning' | 'execution' | 'error';
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
  const SESSION_STORAGE_KEY = 'task_creation_session_id';
  const WELCOME_MESSAGE = '欢迎使用 Altus 任务创建助手！请描述您想要创建的任务。';
  const [isConnected, setIsConnected] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [currentQuestion, setCurrentQuestion] = useState<{
    question: string;
    options?: string[];
  } | null>(null);
  const [location] = useLocation();

  const wsRef = useRef<WebSocket | null>(null);
  const onPlanGeneratedRef = useRef(options?.onPlanGenerated);
  const onErrorRef = useRef(options?.onError);

  useEffect(() => {
    const querySessionId = new URLSearchParams(window.location.search).get('sessionId')?.trim();

    if (querySessionId) {
      if (querySessionId !== sessionId) {
        setMessages([]);
        setCurrentQuestion(null);
        setSessionId(querySessionId);
      }
      window.localStorage.setItem(SESSION_STORAGE_KEY, querySessionId);
      return;
    }

    // 首次进入且无 query sessionId 时，回退到本地缓存会话
    if (!sessionId) {
      const storedSessionId = window.localStorage.getItem(SESSION_STORAGE_KEY);
      if (storedSessionId) {
        setSessionId(storedSessionId);
      }
    }
  }, [location, sessionId]);

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
        const messageSessionId = message.sessionId || message.metadata?.sessionId;
        if (messageSessionId) {
          setSessionId(messageSessionId);
          window.localStorage.setItem(SESSION_STORAGE_KEY, messageSessionId);
        }

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
          case 'status_update':
            if (message.type === 'status_update' && (message.stage === 'completed' || message.stage === 'failed')) {
              setIsProcessing(false);
            }
            // 显示 Agent 消息
            break;

          case 'clarification_request':
            // 显示澄清问题
            setIsProcessing(false);
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
    setCurrentQuestion(null);
    setMessages((prev) => [
      ...prev,
      {
        type: 'user_input',
        content: input,
      },
    ]);

    wsRef.current.send(
      JSON.stringify({
        type: 'user_input',
        content: input,
        sessionId: sessionId || undefined,
      })
    );
  }, [sessionId]);

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
        sessionId: sessionId || undefined,
      })
    );

    setMessages((prev) => [
      ...prev,
      {
        type: 'user_response',
        content: answer,
      },
    ]);
    setCurrentQuestion(null);
  }, [sessionId]);

  // 清空消息
  const clearMessages = useCallback(() => {
    setMessages([]);
    setCurrentQuestion(null);
  }, []);

  const loadHistory = useCallback(async (historySessionId: string) => {
    try {
      const response = await fetch(`http://localhost:4000/api/task-creation/sessions/${historySessionId}/messages`);
      if (!response.ok) {
        return;
      }

      const result = await response.json();
      const list = Array.isArray(result?.data) ? result.data : [];
      const mapped: AgentMessage[] = list.map((item: any) => {
        const metadata = item?.metadata || {};
        const messageType = item?.messageType;
        const role = item?.role;

        if (role === 'user') {
          return {
            type: messageType === 'user_response' ? 'user_response' : 'user_input',
            content: item?.content || '',
            sessionId: historySessionId,
          };
        }

        if (messageType === 'plan_generated') {
          return {
            type: 'plan_generated',
            plan: metadata?.plan,
            content: item?.content,
            sessionId: historySessionId,
          };
        }

        if (messageType === 'clarification_request') {
          return {
            type: 'clarification_request',
            question: metadata?.question || item?.content,
            options: metadata?.options,
            content: item?.content,
            sessionId: historySessionId,
          };
        }

        if (messageType === 'error') {
          return {
            type: 'error',
            message: metadata?.message || item?.content,
            content: item?.content,
            sessionId: historySessionId,
          };
        }

        if (messageType === 'status_update') {
          return {
            type: 'status_update',
            content: item?.content || '',
            stage: metadata?.stage,
            tone: metadata?.tone || 'system',
            agent: metadata?.agent,
            sessionId: historySessionId,
          };
        }

        return {
          type: 'agent_message',
          content: item?.content || '',
          agent: metadata?.agent,
          metadata,
          sessionId: historySessionId,
        };
      });

      setMessages(mapped);
    } catch (error) {
      console.error('[TaskCreationAgent] 加载历史消息失败:', error);
    }
  }, []);

  // 自动连接
  useEffect(() => {
    connect();

    return () => {
      disconnect();
    };
  }, [connect, disconnect]);

  useEffect(() => {
    if (isConnected && sessionId) {
      void loadHistory(sessionId);
    }
  }, [isConnected, sessionId, loadHistory]);

  return {
    isConnected,
    isProcessing,
    messages,
    sessionId,
    currentQuestion,
    sendUserInput,
    answerQuestion,
    clearMessages,
    connect,
    disconnect,
  };
}
