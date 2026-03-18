# OSAC Codex / Executor 扩展设计与交付

日期：2026-03-17  
状态：已完成设计、编译与真实 E2B/Codex 联调验证

## 1. 背景

oneceo 后续要支持 `sandbox + codex` 直通模式，但现有 OSAC 明显是 `OpenCode-first`：

- 协议主要围绕 `OPENCODE_*`
- 配置层主要围绕 OpenCode 二进制与 HTTP server
- 缺少通用 executor 会话抽象

因此本轮先在 OSAC 侧补“最小可用”的 `EXECUTOR_*` 控制面，为 oneceo 主仓库后续接线提供基础。

## 2. 目标

本轮目标只做最小交付，不做大重构：

1. 保留现有 `OPENCODE_*` 协议兼容
2. 新增一套通用 `EXECUTOR_*` 协议消息
3. 新增独立 `codex manager`
4. 支持最小的 runtime ensure / session create / session resume / input send / interrupt / status get
5. 产出 Linux amd64 可部署 binary

## 3. 本轮协议

本轮新增消息：

- `EXECUTOR_RUNTIME_ENSURE`
- `EXECUTOR_SESSION_CREATE`
- `EXECUTOR_SESSION_RESUME`
- `EXECUTOR_INPUT_SEND`
- `EXECUTOR_INTERRUPT`
- `EXECUTOR_STATUS_GET`
- `EXECUTOR_RUNTIME_READY`
- `EXECUTOR_SESSION_READY`
- `EXECUTOR_INPUT_ACCEPTED`
- `EXECUTOR_EVENT`
- `EXECUTOR_STATUS_RESPONSE`
- `EXECUTOR_ERROR`

当前 `EXECUTOR_*` 仅支持：

- `executor=codex`

其他 executor 会返回 `executor_unsupported`，这是刻意保守处理。

## 4. 代码落点

主要变更文件：

- `OSAC_client/internal/config/config.go`
  - 新增 Codex 配置项与环境变量
- `OSAC_client/internal/protocol/protocol.go`
  - 新增 `EXECUTOR_*` payload/response
- `OSAC_client/internal/codex/manager.go`
  - 新增最小 Codex CLI manager
- `OSAC_client/internal/server/server.go`
  - 接入 `codex manager`
  - 新增 `executorConnState`
  - 新增 `EXECUTOR_*` handler
- `OSAC_client/internal/server/bridge_switch_test.go`
  - 修复测试签名兼容

## 5. 当前能力边界

### 5.1 已完成

1. OSAC 能识别并处理 `EXECUTOR_*`
2. 能做 Codex runtime ensure
3. 能创建/恢复最小 session 状态
4. 能通过 Codex CLI JSON 输出回传 `EXECUTOR_EVENT`
5. 能做 interrupt 与 status 查询

### 5.2 未完成

1. 还没有真正的多 executor registry
2. 还没有 `history get`
3. Codex `resume` 语义目前仍依赖 CLI 与本地 bookkeeping
4. 还没有完整覆盖 oneceo 所有 workspace/deploy 类接口

## 6. 编译与验证

已执行：

```bash
cd OSAC_client
PATH=/opt/homebrew/bin:$PATH go test ./...
PATH=/opt/homebrew/bin:$PATH GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -o dist/osac-linux-amd64_v1.1.2.fix24 ./cmd/osac
PATH=/opt/homebrew/bin:$PATH GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -tags debug -o dist/osac-linux-amd64_v1.1.2.fix24_debug ./cmd/osac
```

产物：

- `OSAC_client/dist/osac-linux-amd64_v1.1.2.fix24`
- `OSAC_client/dist/osac-linux-amd64_v1.1.2.fix24_debug`

当前二进制大小约 `11M`。

## 7. 真实联调补充

本轮新增了一次真实 E2B/Codex 联调，结论如下：

1. `codex` E2B 模板内存在 `codex` 可执行文件
   - 实测版本：`codex-cli 0.101.0`
2. Codex template 内没有 `opencode`
   - 这会导致旧版 OSAC 的 `GET_SESSION_LIST`、probe、bridge ready 逻辑报错
   - 典型报错：`exec: "opencode": executable file not found in $PATH`
3. 因此 OSAC 先追加了 `fix23` 修正：
   - 当 sandbox 内不存在 `opencode` 时，相关 probe 与 `GET_SESSION_LIST` 返回空会话列表，而不是失败
4. 在真实多轮续聊时，又追加了 `fix24` 修正：
   - 原因：`codex manager` 把 `workspace` 通过 `-C` 传给了 `codex exec resume`
   - 问题：`codex exec resume` 不支持 `-C/--cd`，导致第二轮输入报错 `unexpected argument '-C' found`
   - 修正：统一改为通过 `exec.Cmd.Dir` 传入 workspace，不再把 `-C` 注入 Codex CLI 参数
5. 修正后，oneceo API 侧已经可以通过：
   - `EXECUTOR_RUNTIME_ENSURE`
   - `EXECUTOR_INPUT_SEND`
   在真实 sandbox 内驱动 Codex，并收到：
   - `thread.started`
   - `turn.started`
   - `item.completed`
   - `turn.completed`
5. 真实 oneceo service smoke 也已通过，证明 OSAC 交付不再只是 isolated binary proof

## 8. 对 oneceo 主仓库的意义

这份交付解决的是“OSAC 侧有没有最小 Codex 控制面”。

它还没有解决：

- oneceo session 是否持久化 `driver`
- oneceo runtime 是否改成 `executorSessionId`
- websocket / routes 是否按 executor 分发
- sandbox provision 是否按 executor 选择 Codex template

因此主仓库后续仍要继续完成：

1. `file-memory-store.ts` session/runtime 去 OpenCode 化
2. `websocket-service.ts` 直通入口抽象
3. `task-creation-routes.ts` detail/history 恢复抽象
4. `codex-remote-service.ts` 与 executor registry
5. `osac-agent-service.ts` / `sandbox-agent-provision-service.ts` 的 Codex 接线

## 9. 风险

1. 当前 Codex transport 先走 CLI，不是 SDK bridge。
2. CLI 的 `resume`、事件字段、历史能力仍可能受版本影响。
3. `GET_SESSION_LIST` 这类控制面能力现在对 `opencode` 缺失做了降级处理，但多 executor 通用化仍未彻底完成。
4. `OSAC_client/` 已被主仓库 `.gitignore` 忽略，因此本文件是主仓库内的追踪文档，不代表 OSAC 代码已经纳入 oneceo 主仓库版本管理。
