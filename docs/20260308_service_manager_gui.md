# 2026-03-08 Service Manager GUI

## 变更目的

提供一个可直接在 macOS 上使用的本地 GUI，用来统一控制 OneCEO 开发环境的四个服务：

- Web
- API
- Admin Web
- Admin API

## 实现位置

- 源码：`tools/service_manager_gui/service_manager_gui.py`
- 打包脚本：`tools/service_manager_gui/build-mac.sh`
- 产物：`tools/service_manager_gui/dist/OneCEO Service Manager.app`

## 能力范围

- 单服务启动、停止、重启
- 全部服务启动、停止、重启
- 显示服务状态、PID、URL
- 输入端口后强制释放监听进程
- 状态探测与启停任务异步执行，避免单个服务异常时拖死整个界面
- 每行展示“超时自动重试 / 失败后可重试 / 按钮优先 / 强制释放端口”的策略提示
- 底部日志面板可切换查看 4 个服务的最近输出
- 点击按钮时后台状态探测降级为低优先级，避免抢占操作
- 复用 `/tmp/oneceo-mac` 与 `/tmp/oneceo-mac-admin` 状态目录，尽量与现有 shell 脚本兼容

## 2026-03-14 并发修复

- 问题：后台定时刷新过于频繁时，会持续占用状态探测与日志读取链路，导致用户点击启动/停止/重启时体感上“按钮被卡住”。
- 修复：
  - GUI 层新增独立的 `refresh_executor` 与 `action_executor`，把后台刷新和用户动作拆分到不同线程池。
  - 控制器层的 `all_statuses()` 改为按服务并行采样，避免四个服务串行探测拖长单次刷新窗口。
  - 状态刷新与日志刷新都带请求序号，旧结果在回到主线程时直接丢弃，避免过期轮询覆盖最新动作结果。
  - 用户触发服务动作或端口强杀时，会短暂暂停低优先级自动刷新，只保留必要的强制刷新，降低刷新线程与操作线程的资源竞争。
- 结果：界面仍保持自动刷新，但启动/停止/重启和端口强杀不再被持续轮询拖住。

## 说明

- Web/API 默认端口使用 `3000` 和 `apps/.env` 中的 `PORT`（默认 `4000`）。
- 管理端端口读取 `apps/.env` 中的 `ADMIN_MANAGEMENT_PORT` / `ADMIN_MANAGEMENT_WEB_PORT` / `VITE_DEV_PORT`，缺省回退到 `9310` / `5174`。
- 打包使用独立虚拟环境内的 PyInstaller，规避当前 Python 环境里旧 `pathlib` 包导致的打包冲突。
