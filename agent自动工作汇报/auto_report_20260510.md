本轮围绕“强模板策略需要变成确定性交付主链”做了三类收口：

1. 部署工具现在把 `web_app/static_site` 的官方固定模板壳要求提升为主链硬门槛，不再放行自由结构网站进入稳定部署车道。
2. 本地部署预检改成优先复用平台 Playwright 契约：`bash -lc` 替代 `sh -lc`，补上 `NODE_PATH` 与 `PLAYWRIGHT_BROWSERS_PATH`，减少假失败。
3. 新增 `platform_capability` 分流：当 sandbox 缺少 Playwright 模块或浏览器二进制时，错误不再下沉给 Altus 继续误修 `package.json`、依赖或固定模板契约文件。

同步更新了部署基线/Manus 固定模板设计文档，明确“固定模板是硬边界，不是建议”，以及“平台能力异常与工作区代码异常必须分流”。

本轮不跑 E2E，交由用户亲自验收；我会用聚焦单测和 type-check 先把收口逻辑锁住。
