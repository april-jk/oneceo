## 2026-03-08

- 做了什么：
  - 新增用户级连接器数据表、DAO、授权/密文/注册表/会话绑定服务。
  - 打通 `/api/connectors` 与 task session attach/detach/list API。
  - 重写前端 `ConnectorDialog`，后续又将用户级连接器中心并入“设置-连接器”，不再保留独立页面。
  - 在“设置-连接器”里补充 GitHub / Slack / Notion / Postgres 的快捷配置说明、官方入口链接、token/key 获取步骤和手动 token 保存入口。
  - 将 Session Connectors 弹层改成紧凑列表样式，支持按行选择、开关挂载，以及底部“添加/授权连接器”“管理连接器”入口。
  - 继续将 Session Connectors 从独立弹窗改成按钮旁一级浮窗，并支持点击连接器进入二级配置浮窗；只有“添加连接器”“管理连接器”仍走设置弹窗。
  - 修正连接器一二级浮窗的视口溢出问题，增加碰撞边界、可用高度收缩和内部滚动。
  - 继续压缩一级连接器浮窗：上方只保留“连接器名称 + 开关”，并改成“头部固定 + 中部独立滚动 + 底部固定操作区”，避免列表和“管理连接器”互相遮挡。
  - 给一级连接器列表补上品牌图标，保持首层为“图标 + 名称 + 开关”的极简选择结构。
  - 补充连接器相关文档与基础单测。
  - 修复连接器查询因 `user_connector_accounts` 等新表未落地而失败的问题，增加启动预热和服务入口兜底迁移。
- 遇到什么：
  - `apps/api` 全量 TypeScript 基线存在大量历史错误，无法用全量 `tsc` 作为本次改动的唯一验证手段。
  - 当前本地会话没有可直接复用的 `DATABASE_URL`，无法对开发库做一次真实连库 smoke test。
- 计划如何解决：
  - 继续把连接器链路的验证维持在新增单测、前端 `tsc`、局部回归上。
  - 通过 API 启动预热和 `userConnectorService` / `sessionConnectorService` 的 `ensureReady()`，避免首个连接器请求直接命中缺表错误。
  - 后续若要把 API 全量 `tsc` 纳入 CI，需要先单独清理仓库历史类型问题。

## 2026-03-08（服务管理 GUI）

- 做了什么：
  - 新增 `tools/service_manager_gui`，实现 macOS 图形化服务控制台。
  - 支持前端、后端、管理前端、管理后端的启动、停止、重启、状态显示与 URL 展示。
  - 增加“输入端口后强杀进程”能力，并补充独立打包脚本 `build-mac.sh`。
  - 已实际打包出 `.app` 产物，放在 `tools/service_manager_gui/dist/OneCEO Service Manager.app`。
- 遇到什么：
  - 当前 Python 全局环境里的旧 `pathlib` backport 会导致 PyInstaller 直接失败。
  - Finder 启动 GUI 时默认 PATH 不可靠，直接找 `pnpm/npm` 有概率失败。
- 计划如何解决：
  - 使用工具目录内独立虚拟环境安装 PyInstaller，避开全局包污染。
  - GUI 启动时主动读取登录 shell 的 PATH，再解析 `pnpm/npm/corepack`，保证双击 `.app` 也能找到 Node 工具链。
