# 2026-04-27 自动工作汇报

## 调试页面正确性校验

- 问题：Altus 在 `debug_open_page` 时只确认 Chromium CDP 接受打开请求，目标本地服务如果未启动也可能回显“页面已打开”，实际调试画面显示 Chrome `ERR_CONNECTION_REFUSED`。
- 处理：收紧 `debug_open_page` 成功边界，先探测目标 URL 返回 2xx/3xx，再打开 CDP tab，并确认目标 tab 出现在 `/json/list`；失败时工具返回失败，要求 Altus 继续修复而不是向用户报成功。
- 验证计划：运行 `altus-managed-tool-runtime` 定向测试和 API 类型检查，必要时再用对应会话做真实链路复测。

## 调试工具失败原因可恢复

- 问题：目标页不可达时，E2B 可能直接抛出 `exit status 1`，导致 Altus 只看到通用失败原因，无法判断应该修服务端口、HTTP 状态还是 CDP 页面。
- 处理：`debug_open_page` 校验脚本改为始终输出结构化状态并正常退出，由 runtime 解析 `target_unreachable / target_bad_status / tab_not_ready` 等标记后抛出带原因的工具错误；事件展示也将这些标记转成用户可读的恢复提示。

## 2026-04-27 调试工具策略收口

- 检查 Altus managed prompt、工具描述、E2B template README 与调试方案文档，发现 browser-use 与 Playwright 的默认优先级表达不一致。
- 已将调试/测试/验收默认路径统一为 Playwright / playwright-mcp 连接 n.eko 同一个 Chromium CDP 9222；browser-use 保留为外部网站探索式交互辅助能力。
- 补充要求：debug_open_page 成功后仍需 Playwright 验证页面不是 about:blank、Chrome 错误页或错误路由，才能对用户声明页面正确显示。

## 2026-04-27 debug_open_page URL 容错

- 修复 `127.0.0.1:8080`、`localhost:3000` 这类无 scheme 本地地址被误判为非法协议的问题。
- 工具运行时会自动补齐本地地址 `http://`，裸外部域名补 `https://`，`file://` 等非 http(s) 协议继续拒绝。

## 2026-04-27 debug_open_page E2B 实际问题定位

- 检查会话 a53b7ae1-6a10-411b-8104-ee45fba2aea8 的 run 事件与 E2B sandbox iyx32dnp3jkvg6995nd3b。
- 日志显示模型把 workspace 内 `index.html` 以 `file://` 传给 `debug_open_page`，工具拒绝后又尝试通过 `shell_execute` 启动 `python3 -m http.server`，但常驻服务启动被 managed shell 规则拦截。
- E2B 内 n.eko、Chromium、CDP 9222 均正常，8000/8080 无监听，CDP tab 停在 `http://127.0.0.1:8080/`，因此浏览器显示连接失败是实际状态。
- 修复方向：`debug_open_page` 安全允许 workspace 内 `file://` 目标，直接用同一个 n.eko Chromium 打开 standalone HTML，workspace 外 file URL 继续拒绝。

## 2026-04-27 shell_execute 受控后台服务

- 将 `shell_execute` 从硬拦截常驻本地服务，调整为 `runMode=auto` 下自动托管预览/dev 服务。
- 常驻服务会以受控后台进程启动，返回 `service.url`、`pid`、`logPath`、`pidPath` 和 `nextSuggestedTool=debug_open_page`。
- `runMode=foreground` 仍显式拒绝常驻服务，避免普通前台工具调用被长任务占住。

## 2026-04-27 n.eko 匿名调试入口

- 问题：n.eko 偶发显示登录页时，现有链路依赖调试 URL 拼接 `pwd` / `usr` 自动登录，调试入口仍有被登录流程阻断的风险。
- 处理：调试服务改为生成 `member.provider: "noauth"` 配置，调试 URL 不再拼接用户名密码；n.eko client patch 隐藏登录表单并自动进入匿名会话。
- 验证计划：补充单测覆盖匿名配置和无凭据 URL，并校验 n.eko UI patch 能应用到上游源码。
