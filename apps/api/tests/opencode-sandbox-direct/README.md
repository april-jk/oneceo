# OpenCode Sandbox直通模式单元测试套件

本目录用于真实模拟 `sandbox直通模式 + opencode执行器` 的核心链路，重点覆盖：

- 首条消息建会话与绑定执行环境
- 同会话续聊（不新建会话）
- SSE 实时增量回传
- 落盘一致性（刷新后可重载历史）
- 会话完成信号（避免前端长期“处理中”）

## 运行前置

- 后端 API 已启动：`http://127.0.0.1:4000`
- `.env` 中 E2B/OpenCode 相关 key 已配置
- 前端是否启动不影响该测试（本套件直接测 API + WS + SSE）
- 套件会默认使用固定测试账号文件登录并携带 `app_session_id`：
  - `apps/web/e2e/playwright-test-account.json`
  - 如需覆盖，可设置 `ONECEO_DIRECT_TEST_ACCOUNT_FILE`

## 运行命令

```bash
cd apps/api
pnpm run test:opencode-direct
```

## 熔断与超时控制

为避免测试卡死，套件内置两级熔断：

- 整轮测试最大时长（默认 10 分钟）：
  - `DIRECT_TEST_MAX_ROUND_MS=600000`
- 单场景最大时长（默认 2 分钟）：
  - `DIRECT_TEST_MAX_SCENARIO_MS=120000`
- SSE 建连超时（默认 20 秒）：
  - `DIRECT_TEST_SSE_CONNECT_TIMEOUT_MS=20000`

示例：

```bash
DIRECT_TEST_MAX_ROUND_MS=600000 DIRECT_TEST_MAX_SCENARIO_MS=120000 pnpm run test:opencode-direct
```

## 输出

运行后会在 `reports/` 下生成：

- `direct-mode-suite-*.json`
- `direct-mode-suite-*.md`

报告包含 suiteId、会话 id、每个场景的断言结果与失败原因。
