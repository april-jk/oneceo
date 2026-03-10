# OSAC mapping_stale 自动恢复（2026-02-24）

## 背景
- 固定会话通过 KVM relay 连接时偶发 `mapping_stale`（HTTP 409）。
- 虽然会回退到端口映射，但日志噪声且不稳定。

## 处理策略
- 在 OSAC 连接器中识别 `mapping_stale`，自动将 `osacMappingEpoch` +1 后重试。
- 若达到最大重试次数仍失败且存在端口回退，则执行 fallback。

## 关键改动
- `oneceo/apps/api/src/connectors/osac-connector.ts`
  - 新增 `isMappingStaleError`。
  - `mapping_stale` 触发 epoch 自增并更新 metadata。

## 验证
- `scripts/_tmp_full_flow_check.ts` 全流程通过，未再出现 `mapping_stale` 日志。
