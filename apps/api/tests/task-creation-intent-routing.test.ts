import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import { IntentRecognitionAgent } from '../src/agents/task-creation/layers/intent-recognition-agent';
import { PlanningAgent } from '../src/agents/task-creation/layers/planning-agent';
import { taskCreationFileMemoryStore } from '../src/agents/task-creation/file-memory-store';
import { TaskCreationService } from '../src/agents/task-creation/task-creation-service';
import { taskCreationSessionDAO, taskSessionRunDAO } from '../src/db/dao';
import { altusManagedSetupService } from '../src/services/altus-managed-setup-service';
import { altusMemoryContextService } from '../src/services/altus-memory-context-service';
import { altusRunCoordinator } from '../src/services/altus-run-coordinator';
import { membershipService } from '../src/services/membership-service';
import { opencodeRemoteService } from '../src/services/opencode-remote-service';

afterEach(() => {
  mock.reset();
});

function installTaskCreationDaoMocks() {
  let savedIntentRecord: any = null;
  let savedTaskDescriptionRecord: any = null;
  let savedExecutionPlanRecord: any = null;

  mock.method(taskCreationSessionDAO, 'getSession', async () => ({
    id: 'session-routing-test',
    userId: 'user-routing-test',
    status: 'in_progress',
  }) as any);
  mock.method(taskCreationSessionDAO, 'bindUserIfMissing', async () => undefined as any);
  mock.method(taskCreationSessionDAO, 'updateSessionStatus', async () => undefined as any);
  mock.method(taskCreationSessionDAO, 'addMessage', async (input: any) => input);
  mock.method(taskCreationSessionDAO, 'getIntentResult', async () => savedIntentRecord);
  mock.method(taskCreationSessionDAO, 'saveIntentResult', async (input: any) => {
    savedIntentRecord = {
      id: 'intent-routing-test',
      ...input,
    };
    return savedIntentRecord;
  });
  mock.method(taskCreationSessionDAO, 'getTaskDescription', async () => savedTaskDescriptionRecord);
  mock.method(taskCreationSessionDAO, 'saveTaskDescription', async (input: any) => {
    savedTaskDescriptionRecord = {
      id: 'task-description-routing-test',
      ...input,
    };
    return savedTaskDescriptionRecord;
  });
  mock.method(taskCreationSessionDAO, 'saveExecutionPlan', async (input: any) => {
    savedExecutionPlanRecord = {
      id: 'execution-plan-routing-test',
      ...input,
    };
    return savedExecutionPlanRecord;
  });

  return {
    getSavedIntentRecord: () => savedIntentRecord,
    getSavedTaskDescriptionRecord: () => savedTaskDescriptionRecord,
    getSavedExecutionPlanRecord: () => savedExecutionPlanRecord,
  };
}

test('IntentRecognitionAgent clarifies broad business software requests before planning', async () => {
  let askedQuestion = '';
  const agent = new IntentRecognitionAgent(async (question) => {
    askedQuestion = question;
    return '给销售和客服团队使用，必须包含客户列表、跟进记录和权限管理，这次只要源码不要部署。';
  });

  const executeMock = mock.method(agent as any, 'execute', async () => {
    throw new Error('deterministic classifier should bypass llm');
  });

  const result = await agent.recognizeIntent('帮我做一个客户管理系统');

  assert.equal(executeMock.mock.callCount(), 0);
  assert.match(askedQuestion, /主要使用角色/);
  assert.match(askedQuestion, /核心模块/);
  assert.match(askedQuestion, /部署/);
  assert.equal(result.intent_type, 'software_development');
  assert.equal(result.clarification_needed, false);
  assert.match(String(result.key_info?.constraints || ''), /不要部署/);
});

test('IntentRecognitionAgent clarifies boundary-only source-code requests instead of falling into other intent', async () => {
  let askedQuestion = '';
  const agent = new IntentRecognitionAgent(async (question) => {
    askedQuestion = question;
    return '给我一个纯 HTML 公司官网源码，包含首页、关于我们和联系我们，不要部署，也不要假设外部平台已授权。';
  });

  const executeMock = mock.method(agent as any, 'execute', async () => {
    throw new Error('boundary-only classifier should bypass llm');
  });

  const result = await agent.recognizeIntent('只生成源码给我，不要部署，也不要假设我已经授权任何外部平台。');

  assert.equal(executeMock.mock.callCount(), 0);
  assert.match(askedQuestion, /具体软件交付物/);
  assert.match(askedQuestion, /只生成源码/);
  assert.equal(result.intent_type, 'software_development');
  assert.equal(result.clarification_needed, false);
  assert.match(String(result.key_info?.constraints || ''), /不要部署/);
  assert.match(String(result.key_info?.constraints || ''), /不要假设已授权任何外部平台/);
});

test('PlanningAgent routes python csv requests to script deliverables instead of web templates', async () => {
  const agent = new PlanningAgent();
  const executeMock = mock.method(agent as any, 'execute', async () => ({
    success: true,
    output: JSON.stringify({
      task_description: {
        title: '营销计划制定',
        objective: '生成可运行的网页应用',
        scope: '浏览器可运行',
        deliverables: ['可运行的网页应用', 'Playwright 验证'],
        constraints: ['确保浏览器可运行'],
      },
    }),
  }));

  const description = await agent.generateTaskDescription(
    {
      intent_type: 'software_development',
      confidence: 0.9,
      key_info: { target: 'Python 脚本' },
      clarification_needed: false,
      next_agent: 'planning_agent',
    } as any,
    '写一个 Python 脚本分析 CSV 并输出 Markdown 报告，不要部署。'
  );

  assert.equal(executeMock.mock.callCount(), 0);
  assert.match(description.objective, /脚本/);
  assert.match(description.scope, /脚本|CLI|分析产物/);
  assert.match(description.deliverables.join(' '), /脚本源码/);
  assert.match(description.deliverables.join(' '), /Markdown|报告|结果/);
  assert.doesNotMatch(description.title, /营销计划/);
  assert.doesNotMatch(description.deliverables.join(' '), /网页应用|Playwright/);
});

test('PlanningAgent routes explicit HTML company website requests to web deliverables', async () => {
  const agent = new PlanningAgent();
  const executeMock = mock.method(agent as any, 'execute', async () => ({
    success: true,
    output: JSON.stringify({
      task_description: {
        title: '营销计划制定',
      },
    }),
  }));

  const description = await agent.generateTaskDescription(
    {
      intent_type: 'software_development',
      confidence: 0.9,
      key_info: { target: '企业官网' },
      clarification_needed: false,
      next_agent: 'planning_agent',
    } as any,
    '做一个纯 HTML 企业官网，包含首页、关于我们、联系我们，并直接部署。'
  );

  assert.equal(executeMock.mock.callCount(), 0);
  assert.match(description.objective, /网站|网页应用/);
  assert.match(description.objective, /部署/);
  assert.match(description.deliverables.join(' '), /网站|网页应用/);
  assert.doesNotMatch(JSON.stringify(description), /营销计划/);
});

test('TaskCreationService keeps boundary-only source-code requests off the marketing path after clarification', async () => {
  process.env.OSAC_EXECUTION_ENABLED = 'false';
  const persisted = installTaskCreationDaoMocks();
  const callbackMessages: any[] = [];
  let askedQuestion = '';
  const service = new TaskCreationService({
    onMessage: (message) => callbackMessages.push(message),
    onAskUser: async (question) => {
      askedQuestion = question;
      return '做一个纯 HTML 公司官网源码，包含首页、关于我们和联系我们，不要部署，也不要假设外部平台已授权。';
    },
  });

  mock.method((service as any).layer1, 'execute', async () => {
    throw new Error('boundary-only classifier should bypass layer1 llm');
  });
  mock.method((service as any).layer2, 'execute', async () => {
    throw new Error('boundary-only classifier should bypass layer2 llm');
  });
  mock.method((service as any).layer3, 'generateExecutionPlan', async (taskDescription: any) => ({
    project: {
      title: taskDescription.title,
      description: taskDescription.objective,
      managers: [
        {
          id: 'm1',
          name: '执行经理',
          description: '负责官网源码交付',
          tasks: [
            {
              id: 't1',
              title: '生成官网源码',
              description: taskDescription.objective,
              estimated_hours: 3,
              deliverables: taskDescription.deliverables,
            },
          ],
        },
      ],
    },
  }));

  const result = await service.createTask(
    '只生成源码给我，不要部署，也不要假设我已经授权任何外部平台。',
    'user-routing-test',
    'session-routing-test'
  );

  const savedTaskDescription = persisted.getSavedTaskDescriptionRecord();
  assert.match(askedQuestion, /具体软件交付物/);
  assert.match(savedTaskDescription.title, /公司官网|首页|关于我们|联系我们/);
  assert.match(savedTaskDescription.constraints.join(' '), /不要部署/);
  assert.match(savedTaskDescription.constraints.join(' '), /不要假设任何外部平台已经授权|不要假设已授权任何外部平台/);
  assert.doesNotMatch(JSON.stringify(savedTaskDescription), /营销计划/);
  assert.doesNotMatch(JSON.stringify(callbackMessages), /营销计划制定/);
  assert.match(result.project.title, /公司官网|首页|关于我们|联系我们/);
});

test('PlanningAgent preserves clarified CRM details instead of falling back to a generic shell', async () => {
  const agent = new PlanningAgent();
  const description = await agent.generateTaskDescription(
    {
      intent_type: 'software_development',
      confidence: 0.92,
      key_info: {
        target:
          '帮我做一个客户管理系统 给销售和客服团队使用，必须包含客户列表、跟进记录和权限管理，这次只要源码不要部署',
        constraints: '不要部署；只交付源码',
      },
      clarification_needed: false,
      next_agent: 'planning_agent',
    } as any,
    '帮我做一个客户管理系统'
  );

  assert.match(description.title, /销售|客服|权限管理/);
  assert.match(description.objective, /销售|客服|权限管理/);
  assert.match(description.constraints.join(' '), /不要部署/);
  assert.match(description.constraints.join(' '), /只交付源码/);
  assert.doesNotMatch(JSON.stringify(description), /营销计划/);
});

test('TaskCreationService keeps python csv tasks on the script lane through execution planning', async () => {
  process.env.OSAC_EXECUTION_ENABLED = 'false';
  const persisted = installTaskCreationDaoMocks();
  const callbackMessages: any[] = [];
  const service = new TaskCreationService({
    onMessage: (message) => callbackMessages.push(message),
    onAskUser: async () => {
      throw new Error('script task should not ask for clarification');
    },
  });

  const layer1ExecuteMock = mock.method((service as any).layer1, 'execute', async () => {
    throw new Error('deterministic classifier should bypass layer1 llm');
  });
  const layer2ExecuteMock = mock.method((service as any).layer2, 'execute', async () => {
    throw new Error('deterministic classifier should bypass layer2 llm');
  });
  mock.method((service as any).layer3, 'generateExecutionPlan', async (taskDescription: any) => ({
    project: {
      title: taskDescription.title,
      description: taskDescription.objective,
      managers: [
        {
          id: 'm1',
          name: '执行经理',
          description: '负责脚本交付',
          tasks: [
            {
              id: 't1',
              title: '生成脚本',
              description: taskDescription.objective,
              estimated_hours: 2,
              deliverables: taskDescription.deliverables,
            },
          ],
        },
      ],
    },
  }));

  const result = await service.createTask(
    '写一个 Python 脚本分析 CSV 并输出 Markdown 报告，不要部署。',
    'user-routing-test',
    'session-routing-test'
  );

  const savedTaskDescription = persisted.getSavedTaskDescriptionRecord();
  assert.equal(layer1ExecuteMock.mock.callCount(), 0);
  assert.equal(layer2ExecuteMock.mock.callCount(), 0);
  assert.match(savedTaskDescription.title, /Python 脚本/);
  assert.match(savedTaskDescription.objective, /脚本/);
  assert.match(savedTaskDescription.constraints.join(' '), /不要部署/);
  assert.doesNotMatch(savedTaskDescription.deliverables.join(' '), /网页应用|Playwright/);
  assert.match(result.project.title, /Python 脚本/);
  assert.equal(persisted.getSavedExecutionPlanRecord()?.projectTitle, result.project.title);
  assert.doesNotMatch(JSON.stringify(callbackMessages), /营销计划/);
});

test('TaskCreationService clarifies CRM requests and persists clarified software task instead of marketing plan', async () => {
  process.env.OSAC_EXECUTION_ENABLED = 'false';
  const persisted = installTaskCreationDaoMocks();
  const callbackMessages: any[] = [];
  let askedQuestion = '';
  const service = new TaskCreationService({
    onMessage: (message) => callbackMessages.push(message),
    onAskUser: async (question) => {
      askedQuestion = question;
      return '给销售和客服团队使用，必须包含客户列表、跟进记录和权限管理，这次只要源码不要部署。';
    },
  });

  mock.method((service as any).layer1, 'execute', async () => {
    throw new Error('deterministic classifier should bypass layer1 llm');
  });
  mock.method((service as any).layer2, 'execute', async () => {
    throw new Error('deterministic classifier should bypass layer2 llm');
  });
  mock.method((service as any).layer3, 'generateExecutionPlan', async (taskDescription: any) => ({
    project: {
      title: taskDescription.title,
      description: taskDescription.objective,
      managers: [
        {
          id: 'm1',
          name: '执行经理',
          description: '负责 CRM 交付',
          tasks: [
            {
              id: 't1',
              title: '实现 CRM 核心模块',
              description: taskDescription.objective,
              estimated_hours: 6,
              deliverables: taskDescription.deliverables,
            },
          ],
        },
      ],
    },
  }));

  const result = await service.createTask(
    '帮我做一个客户管理系统',
    'user-routing-test',
    'session-routing-test'
  );

  const savedTaskDescription = persisted.getSavedTaskDescriptionRecord();
  assert.match(askedQuestion, /主要使用角色/);
  assert.match(askedQuestion, /核心模块/);
  assert.match(savedTaskDescription.title, /销售|客服|权限管理/);
  assert.match(savedTaskDescription.objective, /销售|客服|权限管理/);
  assert.match(savedTaskDescription.constraints.join(' '), /不要部署/);
  assert.doesNotMatch(JSON.stringify(savedTaskDescription), /营销计划/);
  assert.match(result.project.description, /销售|客服|权限管理/);
  assert.doesNotMatch(JSON.stringify(callbackMessages), /营销计划制定/);
});

test('TaskCreationService sandbox prompt skips playwright for script tasks but keeps it for web tasks', () => {
  const service = new TaskCreationService();

  const scriptPrompt = (service as any).buildExecutionBrief({
    userInput: '写一个 Python 脚本分析 CSV 并输出 Markdown 报告，不要部署。',
    taskDescription: {
      title: 'Python 脚本',
      objective: '编写并验证脚本类交付物：Python 脚本分析 CSV 并输出 Markdown 报告',
      scope: '保持脚本/CLI/分析产物形态，不改造成网页应用或部署项目',
      deliverables: ['可运行的脚本源码', 'Markdown 报告', '基础使用说明'],
      constraints: ['不要部署'],
      additional_info: { artifactKind: 'script_artifact' },
    },
    executionPlan: {
      project: {
        title: 'Python 脚本',
        description: '脚本交付',
        managers: [],
      },
    },
  });

  assert.doesNotMatch(scriptPrompt, /playwright-mcp/);
  assert.doesNotMatch(scriptPrompt, /Chromium/);
  assert.match(scriptPrompt, /脚本\/CLI|样例输入|本地验证/);
  assert.match(scriptPrompt, /最小可验证/);
  assert.match(scriptPrompt, /最小样例数据/);

  const webPrompt = (service as any).buildExecutionBrief({
    userInput: '做一个纯 HTML 企业官网，并直接部署。',
    taskDescription: {
      title: '企业官网',
      objective: '实现并交付可部署的网站/网页应用：企业官网',
      scope: '围绕用户目标完成网站实现，并保留可部署所需的最小正确结构',
      deliverables: ['可运行的网站或网页应用', '完整源代码', '部署所需配置与使用说明'],
      constraints: [],
      additional_info: { artifactKind: 'web_app' },
    },
    executionPlan: {
      project: {
        title: '企业官网',
        description: '网站交付',
        managers: [],
      },
    },
  });

  assert.match(webPrompt, /playwright-mcp/);
  assert.match(webPrompt, /Chromium/);
  assert.match(webPrompt, /\/usr\/local\/bin\/playwright-mcp/);
  assert.match(webPrompt, /\/opt\/ms-playwright/);
  assert.match(webPrompt, /NODE_PATH=\/usr\/local\/lib\/node_modules/);
});

test('TaskCreationService execution handoff uses Altus coordinator and never calls OpenCode remote', async () => {
  process.env.OSAC_EXECUTION_ENABLED = 'true';
  process.env.OSAC_EXECUTION_MODE = 'opencode_remote';
  const persisted = installTaskCreationDaoMocks();
  const callbackMessages: any[] = [];
  const service = new TaskCreationService({
    onMessage: (message) => callbackMessages.push(message),
    onAskUser: async () => {
      throw new Error('script task should not ask for clarification');
    },
  });

  mock.method(taskCreationFileMemoryStore, 'getSession', async () => ({
    id: 'session-routing-test',
    title: 'Python CSV task',
  }) as any);
  const createRunMock = mock.method(taskSessionRunDAO, 'createRun', async (input: any) => ({
    id: 'run-altus-1',
    ...input,
  }));
  mock.method(altusManagedSetupService, 'ensureSessionOwnership', async () => ({
    id: 'session-routing-test',
    userId: 'user-routing-test',
  }) as any);
  mock.method(altusManagedSetupService, 'captureConnectorSnapshot', async () => ({
    snapshotId: 'connector-snapshot-1',
    statuses: [],
  }));
  mock.method(altusManagedSetupService, 'captureMcpToolSnapshot', async () => ({
    snapshotId: 'mcp-snapshot-1',
    providers: [],
  }));
  mock.method(membershipService, 'assertUserCanUseAgentLevel', async () => ({
    level: 'lite',
    entitlement: {
      membership: { id: 'membership-1' },
      plan: { id: 'default-plan' },
      allowedAgentLevels: ['lite'],
    },
  }) as any);
  mock.method(altusMemoryContextService, 'buildPromptSectionForRun', async () => ({
    userMemory: {
      preferredName: '',
      occupation: '',
      identity: '',
      location: '',
      background: '',
      preferences: '',
      responsePreferences: '',
    },
    projectMemory: null,
    sessionMemory: {
      version: 0,
      summary: {
        goal: '',
        latestOutcome: '',
        openQuestions: [],
      },
      constraints: [],
      decisions: [],
      workingNotes: [],
      sandboxMaterialization: {
        snapshotVersion: 0,
        lastSandboxId: null,
        lastSyncedAt: null,
      },
      fileMemorySnapshot: {
        snapshotVersion: 0,
        savedAt: null,
        sourceSandboxId: null,
        archiveId: null,
        workspaceMemoryPath: '.oneceo/session-memory/altus-memory.json',
      },
      updatedAt: null,
      lastWriterRunId: null,
    },
    promptSection: '',
  }));

  let capturedState: any = null;
  const coordinatorExecuteMock = mock.method(altusRunCoordinator, 'execute', async (state: any) => {
    capturedState = state;
  });
  const opencodeRemoteMock = mock.method(opencodeRemoteService, 'sendUserInput', async () => {
    throw new Error('Altus task creation should not call OpenCode remote');
  });

  mock.method((service as any).layer1, 'execute', async () => {
    throw new Error('deterministic classifier should bypass layer1 llm');
  });
  mock.method((service as any).layer2, 'execute', async () => {
    throw new Error('deterministic classifier should bypass layer2 llm');
  });
  mock.method((service as any).layer3, 'generateExecutionPlan', async (taskDescription: any) => ({
    project: {
      title: taskDescription.title,
      description: taskDescription.objective,
      managers: [],
    },
  }));

  await service.createTask(
    '写一个 Python 脚本分析 CSV 并输出 Markdown 报告，不要部署。',
    'user-routing-test',
    'session-routing-test'
  );

  assert.equal(createRunMock.mock.callCount(), 1);
  assert.equal(coordinatorExecuteMock.mock.callCount(), 1);
  assert.equal(opencodeRemoteMock.mock.callCount(), 0);
  assert.equal((createRunMock.mock.calls[0]?.arguments[0] as any).mode, 'managed');
  assert.equal((createRunMock.mock.calls[0]?.arguments[0] as any).metadataJson.executionMode, 'altus_managed');
  assert.match(String(capturedState?.input?.userInput || ''), /执行智能体/);
  assert.match(String(capturedState?.input?.userInput || ''), /脚本/);
  assert.equal(capturedState?.input?.taskIntentProfile?.deploymentAllowed, false);
  assert.doesNotMatch(JSON.stringify(callbackMessages), /OpenCode/);
  assert.match(String(persisted.getSavedExecutionPlanRecord()?.projectTitle || ''), /Python 脚本/);
});

test('TaskCreationService execution handoff preserves membership entitlement errors', async () => {
  process.env.OSAC_EXECUTION_ENABLED = 'true';
  process.env.OSAC_EXECUTION_MODE = 'opencode_remote';
  installTaskCreationDaoMocks();
  const callbackMessages: any[] = [];
  const service = new TaskCreationService({
    onMessage: (message) => callbackMessages.push(message),
    onAskUser: async () => {
      throw new Error('script task should not ask for clarification');
    },
  });

  mock.method(taskCreationFileMemoryStore, 'getSession', async () => ({
    id: 'session-routing-test',
    title: 'Python CSV task',
  }) as any);
  mock.method(altusManagedSetupService, 'ensureSessionOwnership', async () => ({
    id: 'session-routing-test',
    userId: 'user-routing-test',
  }) as any);
  mock.method(altusManagedSetupService, 'captureConnectorSnapshot', async () => ({
    snapshotId: 'connector-snapshot-1',
    statuses: [],
  }));
  mock.method(altusManagedSetupService, 'captureMcpToolSnapshot', async () => ({
    snapshotId: 'mcp-snapshot-1',
    providers: [],
  }));
  mock.method(membershipService, 'assertUserCanUseAgentLevel', async () => {
    throw new Error('当前会员类型仅允许使用 agent lite');
  });
  const createRunMock = mock.method(taskSessionRunDAO, 'createRun', async () => {
    throw new Error('run should not be created after entitlement denial');
  });
  const coordinatorExecuteMock = mock.method(altusRunCoordinator, 'execute', async () => {
    throw new Error('coordinator should not run after entitlement denial');
  });

  mock.method((service as any).layer1, 'execute', async () => {
    throw new Error('deterministic classifier should bypass layer1 llm');
  });
  mock.method((service as any).layer2, 'execute', async () => {
    throw new Error('deterministic classifier should bypass layer2 llm');
  });
  mock.method((service as any).layer3, 'generateExecutionPlan', async (taskDescription: any) => ({
    project: {
      title: taskDescription.title,
      description: taskDescription.objective,
      managers: [],
    },
  }));

  await assert.rejects(
    () =>
      service.createTask(
        '写一个 Python 脚本分析 CSV 并输出 Markdown 报告，不要部署。',
        'user-routing-test',
        'session-routing-test',
        { modelTier: 'pro' } as any
      ),
    /当前会员类型仅允许使用 agent lite/
  );
  assert.equal(createRunMock.mock.callCount(), 0);
  assert.equal(coordinatorExecuteMock.mock.callCount(), 0);
  assert.match(JSON.stringify(callbackMessages), /当前会员类型仅允许使用 agent lite/);
});
