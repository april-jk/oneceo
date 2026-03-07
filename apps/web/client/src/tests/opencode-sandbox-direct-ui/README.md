# OpenCode Sandbox直通模式前端渲染单元测试

本目录覆盖直通模式前端消息渲染关键路径：

- 用户输入 + OpenCode 输出的回显映射
- SSE 增量流与 final 终态合并后的渲染优先级
- Diff 事件去重渲染
- `isProcessing` 终止条件判定规则

运行：

```bash
cd apps/web
pnpm run test:opencode-direct-ui
```
