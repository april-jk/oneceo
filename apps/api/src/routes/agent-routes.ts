/**
 * Agent API 路由
 * 
 * 为三个智能体提供 HTTP API 端点
 */

import { Router, type Request, type Response } from 'express';
import { AgentManager } from '../agents';

const router = Router();

// ============================================================================
// 任务创建智能体 API
// ============================================================================

/**
 * POST /api/agents/task-creation/analyze
 * 
 * 分析任务描述并提供创建建议
 */
router.post('/task-creation/analyze', async (req: Request, res: Response) => {
  try {
    const { description, constraints } = req.body;

    if (!description) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_INPUT',
          message: 'Task description is required',
        },
      });
    }

    const agent = AgentManager.getTaskCreationAgent();
    const result = constraints
      ? await agent.generateTaskSuggestions(description, constraints)
      : await agent.analyzeTask(description);

    return res.json({
      success: result.success,
      data: {
        output: result.output,
        intermediateSteps: result.intermediateSteps,
      },
      error: result.error ? { message: result.error } : undefined,
    });
  } catch (error: any) {
    console.error('[TaskCreationAgent API] Error:', error);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: error.message || 'Internal server error',
      },
    });
  }
});

/**
 * POST /api/agents/task-creation/suggest
 * 
 * 生成任务创建建议
 */
router.post('/task-creation/suggest', async (req: Request, res: Response) => {
  try {
    const { description, constraints } = req.body;

    if (!description) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_INPUT',
          message: 'Task description is required',
        },
      });
    }

    const agent = AgentManager.getTaskCreationAgent();
    const result = await agent.generateTaskSuggestions(description, constraints);

    return res.json({
      success: result.success,
      data: {
        output: result.output,
      },
      error: result.error ? { message: result.error } : undefined,
    });
  } catch (error: any) {
    console.error('[TaskCreationAgent API] Error:', error);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: error.message || 'Internal server error',
      },
    });
  }
});

// ============================================================================
// 总经理视图智能体 API
// ============================================================================

/**
 * POST /api/agents/ceo-view/analyze-portfolio
 * 
 * 分析项目组合整体状况
 */
router.post('/ceo-view/analyze-portfolio', async (req: Request, res: Response) => {
  try {
    const { projectIds } = req.body;

    const agent = AgentManager.getCEOViewAgent();
    const result = await agent.analyzePortfolio(projectIds);

    return res.json({
      success: result.success,
      data: {
        output: result.output,
        intermediateSteps: result.intermediateSteps,
      },
      error: result.error ? { message: result.error } : undefined,
    });
  } catch (error: any) {
    console.error('[CEOViewAgent API] Error:', error);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: error.message || 'Internal server error',
      },
    });
  }
});

/**
 * POST /api/agents/ceo-view/executive-summary
 * 
 * 生成执行摘要报告
 */
router.post('/ceo-view/executive-summary', async (req: Request, res: Response) => {
  try {
    const { period = 'weekly' } = req.body;

    if (!['daily', 'weekly', 'monthly'].includes(period)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_INPUT',
          message: 'Period must be one of: daily, weekly, monthly',
        },
      });
    }

    const agent = AgentManager.getCEOViewAgent();
    const result = await agent.generateExecutiveSummary(period);

    return res.json({
      success: result.success,
      data: {
        output: result.output,
      },
      error: result.error ? { message: result.error } : undefined,
    });
  } catch (error: any) {
    console.error('[CEOViewAgent API] Error:', error);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: error.message || 'Internal server error',
      },
    });
  }
});

/**
 * POST /api/agents/ceo-view/resource-analysis
 * 
 * 分析资源分配和识别问题
 */
router.post('/ceo-view/resource-analysis', async (req: Request, res: Response) => {
  try {
    const agent = AgentManager.getCEOViewAgent();
    const result = await agent.identifyResourceIssues();

    return res.json({
      success: result.success,
      data: {
        output: result.output,
      },
      error: result.error ? { message: result.error } : undefined,
    });
  } catch (error: any) {
    console.error('[CEOViewAgent API] Error:', error);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: error.message || 'Internal server error',
      },
    });
  }
});

/**
 * POST /api/agents/ceo-view/decision-support
 * 
 * 提供战略决策支持
 */
router.post('/ceo-view/decision-support', async (req: Request, res: Response) => {
  try {
    const { question, context } = req.body;

    if (!question) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_INPUT',
          message: 'Question is required',
        },
      });
    }

    const agent = AgentManager.getCEOViewAgent();
    const result = await agent.provideDecisionSupport(question, context);

    return res.json({
      success: result.success,
      data: {
        output: result.output,
      },
      error: result.error ? { message: result.error } : undefined,
    });
  } catch (error: any) {
    console.error('[CEOViewAgent API] Error:', error);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: error.message || 'Internal server error',
      },
    });
  }
});

/**
 * POST /api/agents/ceo-view/compare-projects
 * 
 * 比较多个项目的表现
 */
router.post('/ceo-view/compare-projects', async (req: Request, res: Response) => {
  try {
    const { projectIds } = req.body;

    if (!projectIds || !Array.isArray(projectIds) || projectIds.length < 2) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_INPUT',
          message: 'At least 2 project IDs are required for comparison',
        },
      });
    }

    const agent = AgentManager.getCEOViewAgent();
    const result = await agent.compareProjects(projectIds);

    return res.json({
      success: result.success,
      data: {
        output: result.output,
      },
      error: result.error ? { message: result.error } : undefined,
    });
  } catch (error: any) {
    console.error('[CEOViewAgent API] Error:', error);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: error.message || 'Internal server error',
      },
    });
  }
});

// ============================================================================
// 任务详情智能体 API
// ============================================================================

/**
 * POST /api/agents/task-detail/guidance
 * 
 * 提供任务执行指导
 */
router.post('/task-detail/guidance', async (req: Request, res: Response) => {
  try {
    const { taskId, question, userRole = 'employee' } = req.body;

    if (!taskId || !question) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_INPUT',
          message: 'Task ID and question are required',
        },
      });
    }

    if (!['manager', 'employee'].includes(userRole)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_INPUT',
          message: 'User role must be either "manager" or "employee"',
        },
      });
    }

    const agent = AgentManager.getTaskDetailAgent();
    const result = await agent.provideGuidance(taskId, question, userRole);

    return res.json({
      success: result.success,
      data: {
        output: result.output,
        intermediateSteps: result.intermediateSteps,
      },
      error: result.error ? { message: result.error } : undefined,
    });
  } catch (error: any) {
    console.error('[TaskDetailAgent API] Error:', error);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: error.message || 'Internal server error',
      },
    });
  }
});

/**
 * POST /api/agents/task-detail/generate-document
 * 
 * 生成任务文档
 */
router.post('/task-detail/generate-document', async (req: Request, res: Response) => {
  try {
    const { taskId, documentType } = req.body;

    if (!taskId || !documentType) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_INPUT',
          message: 'Task ID and document type are required',
        },
      });
    }

    if (!['plan', 'progress', 'deliverable', 'summary'].includes(documentType)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_INPUT',
          message: 'Document type must be one of: plan, progress, deliverable, summary',
        },
      });
    }

    const agent = AgentManager.getTaskDetailAgent();
    const result = await agent.generateDocument(taskId, documentType);

    return res.json({
      success: result.success,
      data: {
        output: result.output,
      },
      error: result.error ? { message: result.error } : undefined,
    });
  } catch (error: any) {
    console.error('[TaskDetailAgent API] Error:', error);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: error.message || 'Internal server error',
      },
    });
  }
});

/**
 * POST /api/agents/task-detail/analyze-progress
 * 
 * 分析任务进度
 */
router.post('/task-detail/analyze-progress', async (req: Request, res: Response) => {
  try {
    const { taskId, currentStatus } = req.body;

    if (!taskId) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_INPUT',
          message: 'Task ID is required',
        },
      });
    }

    const agent = AgentManager.getTaskDetailAgent();
    const result = await agent.analyzeProgress(taskId, currentStatus);

    return res.json({
      success: result.success,
      data: {
        output: result.output,
      },
      error: result.error ? { message: result.error } : undefined,
    });
  } catch (error: any) {
    console.error('[TaskDetailAgent API] Error:', error);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: error.message || 'Internal server error',
      },
    });
  }
});

/**
 * POST /api/agents/task-detail/identify-blockers
 * 
 * 识别任务阻塞因素
 */
router.post('/task-detail/identify-blockers', async (req: Request, res: Response) => {
  try {
    const { taskId, description } = req.body;

    if (!taskId) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_INPUT',
          message: 'Task ID is required',
        },
      });
    }

    const agent = AgentManager.getTaskDetailAgent();
    const result = await agent.identifyBlockers(taskId, description);

    return res.json({
      success: result.success,
      data: {
        output: result.output,
      },
      error: result.error ? { message: result.error } : undefined,
    });
  } catch (error: any) {
    console.error('[TaskDetailAgent API] Error:', error);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: error.message || 'Internal server error',
      },
    });
  }
});

/**
 * POST /api/agents/task-detail/validate-deliverable
 * 
 * 验证任务交付物
 */
router.post('/task-detail/validate-deliverable', async (req: Request, res: Response) => {
  try {
    const { taskId, deliverable } = req.body;

    if (!taskId || !deliverable) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_INPUT',
          message: 'Task ID and deliverable are required',
        },
      });
    }

    const agent = AgentManager.getTaskDetailAgent();
    const result = await agent.validateDeliverable(taskId, deliverable);

    return res.json({
      success: result.success,
      data: {
        output: result.output,
      },
      error: result.error ? { message: result.error } : undefined,
    });
  } catch (error: any) {
    console.error('[TaskDetailAgent API] Error:', error);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: error.message || 'Internal server error',
      },
    });
  }
});

/**
 * POST /api/agents/task-detail/suggest-next-steps
 * 
 * 建议下一步行动
 */
router.post('/task-detail/suggest-next-steps', async (req: Request, res: Response) => {
  try {
    const { taskId, currentStage } = req.body;

    if (!taskId || !currentStage) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_INPUT',
          message: 'Task ID and current stage are required',
        },
      });
    }

    if (!['planning', 'executing', 'reviewing', 'completed'].includes(currentStage)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_INPUT',
          message: 'Current stage must be one of: planning, executing, reviewing, completed',
        },
      });
    }

    const agent = AgentManager.getTaskDetailAgent();
    const result = await agent.suggestNextSteps(taskId, currentStage);

    return res.json({
      success: result.success,
      data: {
        output: result.output,
      },
      error: result.error ? { message: result.error } : undefined,
    });
  } catch (error: any) {
    console.error('[TaskDetailAgent API] Error:', error);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: error.message || 'Internal server error',
      },
    });
  }
});

/**
 * POST /api/agents/task-detail/generate-checklist
 * 
 * 生成任务检查清单
 */
router.post('/task-detail/generate-checklist', async (req: Request, res: Response) => {
  try {
    const { taskId, taskType } = req.body;

    if (!taskId) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_INPUT',
          message: 'Task ID is required',
        },
      });
    }

    const agent = AgentManager.getTaskDetailAgent();
    const result = await agent.generateChecklist(taskId, taskType);

    return res.json({
      success: result.success,
      data: {
        output: result.output,
      },
      error: result.error ? { message: result.error } : undefined,
    });
  } catch (error: any) {
    console.error('[TaskDetailAgent API] Error:', error);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: error.message || 'Internal server error',
      },
    });
  }
});

// ============================================================================
// 通用 Agent API
// ============================================================================

/**
 * GET /api/agents/info
 * 
 * 获取所有智能体的信息
 */
router.get('/info', (req: Request, res: Response) => {
  try {
    const info = AgentManager.getAllAgentsInfo();
    return res.json({
      success: true,
      data: info,
    });
  } catch (error: any) {
    console.error('[Agent Info API] Error:', error);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: error.message || 'Internal server error',
      },
    });
  }
});

export default router;
