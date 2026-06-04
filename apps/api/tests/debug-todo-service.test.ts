import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  generateDebugTodo,
  getDebugTodo,
  linkDebugTodoToolFailure,
  saveDebugTodo,
} from '../src/services/debug-todo-service';

describe('debug todo service', () => {
  it('marks the linked debug todo item failed when a browser tool fails before screenshot capture', () => {
    const sessionId = `debug-todo-failure-${Date.now()}`;
    const todo = generateDebugTodo({
      sessionId,
      triggerReason: '验证落子功能',
      debugDepth: 'full_link',
    });
    todo.items = [
      {
        id: 'debug-003',
        testUnit: '落子功能',
        unitType: 'page_action',
        expectedInput: '点击棋盘格',
        expectedOutput: '放置棋子并切换回合',
        boundaryConditions: '定位器必须匹配真实棋盘格',
        verificationMethod: 'browser_interact 点击棋盘格',
        status: 'pending',
      },
    ];
    saveDebugTodo(todo);

    const link = linkDebugTodoToolFailure({
      sessionId,
      itemId: 'debug-003',
      toolName: 'browser_interact',
      action: 'locator_click',
      description: '在棋盘上点击放置第一颗黑子',
      reasonCode: 'managed_tool_error',
      errorMessage:
        "browser_interact_failed: locator.click: Timeout 5000ms exceeded. diagnostics=playwright_action | /internal/path",
    });

    const updated = getDebugTodo(sessionId);
    assert.equal(link.status, 'linked');
    assert.equal(link.itemId, 'debug-003');
    assert.equal(link.itemStatus, 'failed');
    assert.equal(link.reasonCode, 'managed_tool_error');
    assert.match(link.message || '', /Timeout 5000ms exceeded/);
    assert.equal(updated?.items[0]?.status, 'failed');
    assert.match(updated?.items[0]?.actualResult || '', /在棋盘上点击放置第一颗黑子 未通过/);
    assert.doesNotMatch(updated?.items[0]?.actualResult || '', /diagnostics=/);
  });
});
