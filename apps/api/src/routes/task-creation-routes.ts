/**
 * 任务创建 API 路由
 * 
 * 提供任务创建历史、会话详情等查询接口
 */

import express from 'express';
import { taskCreationSessionDAO } from '../db/dao';

const router = express.Router();

/**
 * GET /api/task-creation/sessions
 * 获取最近的任务创建会话列表
 */
router.get('/sessions', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 10;
    const userId = req.query.userId as string;

    const sessions = await taskCreationSessionDAO.getRecentSessions(limit, userId);

    res.json({
      success: true,
      data: sessions,
    });
  } catch (error: any) {
    console.error('获取会话列表失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '获取会话列表失败',
    });
  }
});

/**
 * GET /api/task-creation/sessions/:sessionId
 * 获取会话的完整信息（包括所有关联数据）
 */
router.get('/sessions/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;

    const sessionData = await taskCreationSessionDAO.getSessionWithDetails(sessionId);

    if (!sessionData) {
      return res.status(404).json({
        success: false,
        error: '会话不存在',
      });
    }

    res.json({
      success: true,
      data: sessionData,
    });
  } catch (error: any) {
    console.error('获取会话详情失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '获取会话详情失败',
    });
  }
});

/**
 * GET /api/task-creation/sessions/:sessionId/messages
 * 获取会话的对话消息
 */
router.get('/sessions/:sessionId/messages', async (req, res) => {
  try {
    const { sessionId } = req.params;

    const messages = await taskCreationSessionDAO.getMessages(sessionId);

    res.json({
      success: true,
      data: messages,
    });
  } catch (error: any) {
    console.error('获取对话消息失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '获取对话消息失败',
    });
  }
});

/**
 * GET /api/task-creation/sessions/:sessionId/intent
 * 获取会话的意图识别结果
 */
router.get('/sessions/:sessionId/intent', async (req, res) => {
  try {
    const { sessionId } = req.params;

    const intentResult = await taskCreationSessionDAO.getIntentResult(sessionId);

    if (!intentResult) {
      return res.status(404).json({
        success: false,
        error: '意图识别结果不存在',
      });
    }

    res.json({
      success: true,
      data: intentResult,
    });
  } catch (error: any) {
    console.error('获取意图识别结果失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '获取意图识别结果失败',
    });
  }
});

/**
 * GET /api/task-creation/sessions/:sessionId/task-description
 * 获取会话的任务描述
 */
router.get('/sessions/:sessionId/task-description', async (req, res) => {
  try {
    const { sessionId } = req.params;

    const taskDescription = await taskCreationSessionDAO.getTaskDescription(sessionId);

    if (!taskDescription) {
      return res.status(404).json({
        success: false,
        error: '任务描述不存在',
      });
    }

    res.json({
      success: true,
      data: taskDescription,
    });
  } catch (error: any) {
    console.error('获取任务描述失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '获取任务描述失败',
    });
  }
});

/**
 * GET /api/task-creation/sessions/:sessionId/execution-plan
 * 获取会话的执行计划
 */
router.get('/sessions/:sessionId/execution-plan', async (req, res) => {
  try {
    const { sessionId } = req.params;

    const executionPlan = await taskCreationSessionDAO.getExecutionPlan(sessionId);

    if (!executionPlan) {
      return res.status(404).json({
        success: false,
        error: '执行计划不存在',
      });
    }

    res.json({
      success: true,
      data: executionPlan,
    });
  } catch (error: any) {
    console.error('获取执行计划失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '获取执行计划失败',
    });
  }
});

/**
 * DELETE /api/task-creation/sessions/:sessionId
 * 删除会话（级联删除所有关联数据）
 */
router.delete('/sessions/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;

    await taskCreationSessionDAO.deleteSession(sessionId);

    res.json({
      success: true,
      message: '会话已删除',
    });
  } catch (error: any) {
    console.error('删除会话失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '删除会话失败',
    });
  }
});

export default router;
