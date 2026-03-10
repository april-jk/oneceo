# 2026-03-07 刷新后解释消息丢失（二次修复）

## 问题复现
- 对比 `debug/111刷新前.txt` 与 `debug/111刷新后.txt`：刷新后解释性 OpenCode 文本明显减少，仅剩少量汇总文本与大量原子事件。

## 根因
- 后端 `opencode-remote-service` 在 direct 模式执行 `flushTextStreams` 时使用 `persistMode: latest`。
- `latest` 只会把当前批次文本流中的最后一条写入历史，前面的解释文本不会落盘。
- 因此未刷新时（实时流）可见，刷新后（依赖落盘历史）丢失。

## 修复
- 文件：`apps/api/src/services/opencode-remote-service.ts`
- 将 direct 模式相关 `flushTextStreams` 调用统一改为 `persistMode: all`：
  1. `OPENCODE_ERROR` 分支
  2. `outcome === completed` 分支
  3. `outcome === failed` 且 direct 分支
- `all` 模式并不是保存所有 delta，而是“每个 stream(part) 保留 latest”，可兼顾完整回放与体量控制。

## 影响
- 刷新后历史可恢复同轮执行中的多段解释文本，不再只剩最终一条。
- 对实时流渲染无副作用，仅增强历史落盘完整性。

## 验证
- `pnpm -C apps/api type-check` 仍存在仓库历史类型错误（与本次改动无关），未见本次改动新增的定位性错误。
- 建议用新会话复测：同样 prompt，完成后刷新，检查解释消息数量与顺序。
