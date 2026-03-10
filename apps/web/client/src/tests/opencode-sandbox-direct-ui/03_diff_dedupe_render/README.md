# 03_diff_dedupe_render

目标：验证仅展示由 OpenCode 主动文件修改工具触发的 diff（`apply_patch` / `write` / `edit` 关联的 `session.diff`），并去重重复补丁。

模拟内容：

- 一条无关联的 `session.diff`（应忽略）
- 两条结构完全相同的 `apply_patch`
- 一条位于 `node_modules` 路径的 `apply_patch`
- 一条位于 Python `venv` 路径的 `apply_patch`
- 一组 `write` + `session.diff`（应保留）

预期：

- 仅渲染一个重复去重后的 Diff 原子卡片（来源 `apply_patch`）
- `node_modules` / `venv` 路径在 `apply_patch` 场景下仍正常显示（不做目录黑名单）
- `write` / `edit` 触发且与之关联的 `session.diff` 会进入“更改”列表
