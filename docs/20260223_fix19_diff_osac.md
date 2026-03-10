# 2026-02-23 OSAC Fix19 Diff 补齐记录

## 目标
- 修复 oneceo Web 端 `session.diff` 无数据的问题。
- 在 OSAC 侧对空 diff 进行补齐，确保前端能拿到结构化 diff。

## 变更摘要
- OSAC 事件转发中，当收到 `session.diff` 且 `diff` 为空时，调用 OpenCode `GET /session/{id}/diff` 回填到事件 `properties.diff`。
- 版本号升级：`v1.1.2.fix19`。

## 构建产物
- `agentClient_on_KVM/client_on_kvm/dist/osac-linux-amd64_v1.1.2.fix19`
- `agentClient_on_KVM/client_on_kvm/dist/osac-linux-amd64_v1.1.2.fix19_debug`
- 已同步到：`oneceo/others/osac-linux/`

## 配置变更
- `oneceo/apps/api/.env`
- `oneceo/apps/.env`

`OSAC_BINARY_PATH` -> `../../others/osac-linux/osac-linux-amd64_v1.1.2.fix19`

## 下发与运行
- 使用 `apps/api/debug/_tmp_restart_osac.ts` 重新下发并启动 OSAC。
- 默认 sandbox：读取 `OSAC_FIXED_SANDBOX_SESSION_ID`（若未设置则使用 `sess_4471f12d0bc444d3`）。

## 验证要点
- Web 端 `session.diff` 事件应产生 diff 列表或统一 diff 文本。
- 预览面板能展示文件变更与 +/- 统计。
