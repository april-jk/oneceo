/**
 * 数据库功能测试脚本
 * 
 * 测试任务创建会话的完整流程
 */

import { testDatabaseConnection, closeDatabaseConnection } from '../config/database';
import { taskCreationSessionDAO } from './dao';

async function testDatabase() {
  console.log('🧪 开始测试数据库功能...\n');

  try {
    // 1. 测试数据库连接
    console.log('1️⃣ 测试数据库连接...');
    const connected = await testDatabaseConnection();
    if (!connected) {
      throw new Error('数据库连接失败');
    }
    console.log('✅ 数据库连接成功\n');

    // 2. 创建测试会话
    console.log('2️⃣ 创建测试会话...');
    const session = await taskCreationSessionDAO.createSession({
      userId: 'test-user-001',
    });
    console.log('✅ 会话创建成功:', session.id);
    console.log('   - 状态:', session.status);
    console.log('   - 创建时间:', session.createdAt);
    console.log('');

    // 3. 添加对话消息
    console.log('3️⃣ 添加对话消息...');
    const message1 = await taskCreationSessionDAO.addMessage({
      sessionId: session.id,
      role: 'user',
      content: '我想做一个Python开发行业的市场调研',
      messageType: 'user_input',
    });
    console.log('✅ 用户消息已保存:', message1.id);

    const message2 = await taskCreationSessionDAO.addMessage({
      sessionId: session.id,
      role: 'agent',
      content: '正在分析您的任务需求...',
      messageType: 'agent_message',
    });
    console.log('✅ Agent 消息已保存:', message2.id);
    console.log('');

    // 4. 保存意图识别结果
    console.log('4️⃣ 保存意图识别结果...');
    const intentResult = await taskCreationSessionDAO.saveIntentResult({
      sessionId: session.id,
      userInput: '我想做一个Python开发行业的市场调研',
      intentType: 'research',
      confidence: 95,
      keyInfo: {
        target: 'Python开发行业',
        scope: '市场调研',
        constraints: [],
      },
      clarificationNeeded: false,
    });
    console.log('✅ 意图识别结果已保存:', intentResult.id);
    console.log('   - 意图类型:', intentResult.intentType);
    console.log('   - 置信度:', intentResult.confidence);
    console.log('');

    // 5. 保存任务描述
    console.log('5️⃣ 保存任务描述...');
    const taskDescription = await taskCreationSessionDAO.saveTaskDescription({
      sessionId: session.id,
      intentResultId: intentResult.id,
      title: 'Python开发行业市场调研',
      objective: '了解2024年Python开发行业的市场趋势、技术栈、薪资水平和就业前景',
      scope: '中文市场，重点关注Web开发和数据科学领域',
      deliverables: ['市场分析报告', '技术栈调研报告', '薪资水平分析'],
      constraints: { time: '2周', budget: '无限制' },
    });
    console.log('✅ 任务描述已保存:', taskDescription.id);
    console.log('   - 标题:', taskDescription.title);
    console.log('   - 目标:', taskDescription.objective);
    console.log('');

    // 6. 保存执行计划
    console.log('6️⃣ 保存执行计划...');
    const executionPlan = await taskCreationSessionDAO.saveExecutionPlan({
      sessionId: session.id,
      taskDescriptionId: taskDescription.id,
      projectTitle: 'Python开发行业市场调研',
      projectDescription: '全面分析Python开发行业的市场状况',
      estimatedTotalHours: 80,
      managers: [
        {
          id: 'm1',
          name: '市场研究经理',
          description: '负责市场调研和数据分析',
          tasks: [
            {
              id: 't1',
              title: '行业趋势分析',
              description: '分析Python开发行业的最新趋势',
              estimated_hours: 40,
              deliverables: ['趋势分析报告'],
            },
          ],
        },
      ],
    });
    console.log('✅ 执行计划已保存:', executionPlan.id);
    console.log('   - 项目标题:', executionPlan.projectTitle);
    console.log('   - 预估总时长:', executionPlan.estimatedTotalHours, '小时');
    console.log('');

    // 7. 更新会话状态
    console.log('7️⃣ 更新会话状态...');
    await taskCreationSessionDAO.updateSessionStatus(session.id, 'completed');
    console.log('✅ 会话状态已更新为: completed\n');

    // 8. 查询会话完整信息
    console.log('8️⃣ 查询会话完整信息...');
    const sessionData = await taskCreationSessionDAO.getSessionWithDetails(session.id);
    console.log('✅ 会话完整信息:');
    console.log('   - 会话ID:', sessionData?.session.id);
    console.log('   - 状态:', sessionData?.session.status);
    console.log('   - 消息数量:', sessionData?.messages.length);
    console.log('   - 意图类型:', sessionData?.intentResult?.intentType);
    console.log('   - 任务标题:', sessionData?.taskDescription?.title);
    console.log('   - 执行计划:', sessionData?.executionPlan?.projectTitle);
    console.log('');

    // 9. 查询最近的会话列表
    console.log('9️⃣ 查询最近的会话列表...');
    const recentSessions = await taskCreationSessionDAO.getRecentSessions(5);
    console.log('✅ 最近的会话:');
    recentSessions.forEach((s, index) => {
      console.log(`   ${index + 1}. ${s.id} - ${s.status} - ${s.createdAt}`);
    });
    console.log('');

    // 10. 清理测试数据
    console.log('🧹 清理测试数据...');
    await taskCreationSessionDAO.deleteSession(session.id);
    console.log('✅ 测试数据已清理\n');

    console.log('🎉 所有测试通过！数据库功能正常。\n');
  } catch (error) {
    console.error('❌ 测试失败:', error);
    throw error;
  } finally {
    await closeDatabaseConnection();
  }
}

// 运行测试
if (import.meta.url === `file://${process.argv[1]}`) {
  testDatabase()
    .then(() => {
      console.log('测试完成，退出...');
      process.exit(0);
    })
    .catch((error) => {
      console.error('测试失败:', error);
      process.exit(1);
    });
}
