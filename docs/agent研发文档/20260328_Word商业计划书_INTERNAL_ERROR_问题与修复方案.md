# 20260328 Word 商业计划书 INTERNAL_ERROR 问题与修复方案

## 1. 问题现象

用户在选择 `Word 文档` skill 后，请求生成建筑智慧运维平台商业计划书，前端最终显示：

```json
{"success":false,"error":{"code":"INTERNAL_ERROR","message":"服务异常，请稍后重试"}}
```

对应会话与运行：

- `sessionId = c398d1d3-7874-428c-a440-7ebccd7a08eb`
- `runId = d69ea6e5-b1d1-408d-9205-6ed7039e7ee4`

## 2. 根因结论

这次不是 `Word 文档` skill 模板失效，也不是 `web_search / web_extract` 本身失败。

真正根因是：

1. `Altus managed` 在长文档任务中多次调用 `write_file`
2. `write_file` 的完整大文本内容会作为 tool call arguments 回灌到下一轮模型请求
3. `/api/llm-proxy` 路由当前使用了默认 `express.raw()`，没有显式放大 body limit
4. 当下一轮 `POST /api/llm-proxy/v1/chat/completions` 请求体超过默认上限时，请求会在路由前被 Express 拦截
5. 该异常最后被主应用错误处理中间件包装成通用 `500 INTERNAL_ERROR`

因此表面现象是“Altus managed 运行失败”，实质上是：

`llm-proxy` 请求体过大，导致下一轮模型调用进不了代理逻辑。

## 3. 证据

### 3.1 运行事件序列

该 run 在失败前已经成功执行了多步：

- `read_file`
- `web_search`
- `web_search`
- `write_file`
- `shell_execute`
- `write_file`

失败发生在最后一次 `write_file` 完成之后，而不是 run 刚启动时。

### 3.2 大参数体量

该 run 内两次 `write_file` 的 arguments 长度分别达到：

- `13774`
- `37427`

这说明商业计划书正文已经被直接塞进了工具参数。

### 3.3 本地复现实验

向当前 `/api/llm-proxy/v1/chat/completions` 发送一个约 `130178 bytes` 的请求体，接口直接返回：

```json
{"success":false,"error":{"code":"INTERNAL_ERROR","message":"服务异常，请稍后重试"}}
```

这与用户现场报错完全一致，说明失败点就在 `llm-proxy` 请求体限制，而不是 `Word` skill 逻辑本身。

## 4. 修复方案

采用最短正确路径，不改业务流程，不改模型提示词，不引入额外兜底链路。

仅做一处主修复：

- 在 `apps/api/src/index.ts` 中为 `/api/llm-proxy` 的 `express.raw()` 显式配置更大的 body limit

实现方式：

- 新增 `LLM_PROXY_BODY_LIMIT_MB`
- 默认值提升到 `64mb`
- 上限钳制到 `128mb`，避免误配置导致单请求无限膨胀

## 5. 修改位置

- `apps/api/src/index.ts`

## 6. 影响

修复后，像 `Word 商业计划书`、长篇 `PPT`、长篇 `Excel` 生成这类会产生较大 `write_file` 参数回灌的任务，不会再因为默认 `100kb` 左右的 raw body 限制而直接被打成通用 `INTERNAL_ERROR`。

这次修复解决的是“请求体进不了 llm-proxy”的主问题，不改变现有的 Office skill、联网检索、交付物闭环和 sandbox 逻辑。

## 7. 验证方式

### 7.1 代理大请求体验证

向 `/api/llm-proxy/v1/chat/completions` 发送超过 `100kb` 的大请求体。

预期：

- 不再立即返回通用 `500 INTERNAL_ERROR`
- 请求能够进入 `llm-proxy` 正常处理链路

### 7.2 Word 场景回归

重新执行类似输入：

- `帮我生成一份商业计划书，有关建筑智慧运维平台的`
- 并附带 `skill-office-docx.md`

预期：

- 不再出现本次同类 `INTERNAL_ERROR`
- run 至少能够继续进入正常的模型调用与工具执行链路

## 8. 实际验证结果

### 8.1 代理大请求体验证

修复前：

- 约 `130178 bytes` 的请求体会直接返回通用 `500 INTERNAL_ERROR`

修复后：

- 同样大小的请求体已经可以正常进入 llm-proxy 处理链路
- 本地探针返回 `200`，且拿到了流式 chunk 响应

### 8.2 Word 真链路回归

使用 `skill-office-docx` 重新执行：

- `帮我生成一份商业计划书，有关建筑智慧运维平台的，最终文件名为 smart-building-business-plan.docx`

回归结果：

- `runId = 763b2cd6-a82e-4929-87b4-0c5170db38f6`
- `status = completed`
- `usedTools = ["complete_task","shell_execute","web_search","write_file"]`
- 成功交付 `smart-building-business-plan.docx`
- 下载大小 `43554 bytes`

测试产生的 sandbox `iwcechj9lb3cupbet4a1p` 已关闭，会话 `b08e8430-19c4-4918-9763-ea62bef66084` 已删除，没有留下额外计费资源。
