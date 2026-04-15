# Slack / Notion 参照 GitHub 卡片式 OAuth 授权改造实现文档 [20260415-1932已采用]

## 1. 背景

当前连接器中心里，GitHub 已经采用了“单卡片双态”的极简授权体验：

- 未授权时只展示平台信息与“连接”按钮
- 已授权时只展示授权状态、管理入口与重新连接入口
- Profile 创建、选择、回调挂载等底层动作被隐藏在界面背后

但 Slack 与 Notion 仍存在以下不一致：

- Slack 仍保留 token 输入路径与相关说明
- Notion 虽然主链已是 OAuth，但详情页仍混入 Profile 配置块
- 两者都没有完整复刻 GitHub 的卡片结构和平台使用指南呈现方式

本方案目标是在**不修改现有程序主逻辑**的前提下，把 Slack 与 Notion 的授权体验收敛到 GitHub 同款卡片方案，并补充平台使用指南。

## 2. 目标与范围

### 2.1 目标

1. Slack 与 Notion 详情页统一采用 GitHub 风格卡片。
2. 两者只保留“连接外部平台 OAuth 授权”这一条用户路径。
3. 删除 token 授权入口、对应输入框和相关提示文案。
4. 在卡片下方补充平台使用指南，帮助用户正确完成授权与后续使用。
5. 继续复用当前已存在的 connector-level OAuth、回调、默认 profile、session 自动挂载能力。

### 2.2 非目标

1. 不修改 `startOAuth / completeOAuth / attachSessionConnector` 主链逻辑。
2. 不修改 Slack / Notion MCP runtime 行为。
3. 不新增多账号、多 profile 的高级管理入口。
4. 不做历史数据迁移，不删除数据库中既有 secret。
5. 不改 GitHub 当前卡片逻辑，只把它作为参照基线。

## 3. 参照基线

本方案直接参照以下现有实现与设计：

- 设计文档：`docs/features/connectors/github_auth_logic_[20260330-1000已采用].md`
- 前端详情页：`apps/web/client/src/components/ConnectorCenterPanel.tsx`
- 前端使用指南：`apps/web/client/src/lib/connector-guides.ts`
- Slack 定义：`apps/api/src/connectors/definitions/slack.ts`
- Notion 定义：`apps/api/src/connectors/definitions/notion.ts`

## 4. 当前现状与问题

### 4.1 已有能力

当前仓库已经具备以下可复用能力：

1. `shouldUseConnectorLevelOauth(connectorKey)` 已把 `slack` 和 `notion` 判定为 connector-level OAuth。
2. `handleOAuth()` 已支持 Slack / Notion 直接走 `startConnectorOauth(...)`。
3. 后端已提供：
   - `POST /api/connectors/:connectorKey/oauth/start`
   - `POST /api/connectors/:connectorKey/oauth/callback`
   - `DELETE /api/connectors/:connectorKey/auth`
4. `userConnectorService.startOAuth(...)` 已支持“没有 profile 时自动创建默认 profile”。
5. OAuth 回调后，前端已支持自动 attach 回目标 session。

### 4.2 现有问题

#### Slack

1. `apps/api/src/connectors/definitions/slack.ts` 仍暴露 `accessToken` 字段。
2. Slack guide 仍有“手工填写 user token”的说明。
3. 详情页由于仍走通用 Profile 配置块，用户依旧能看到 token 输入路径。

#### Notion

1. Notion 后端定义已是 OAuth 主链，但详情页仍保留通用 Profile 管理块。
2. Notion guide 仍有“integration secret / access token 直接粘贴”的旧文案。
3. 当前界面没有把“授权成功后还需要把 page/database 分享给 integration”作为显式指南展示出来。

#### 详情页结构问题

`ConnectorCenterPanel.tsx` 当前详情页里存在一个关键不一致：

- `handleOAuth()` 用的是 `shouldUseConnectorLevelOauth(detailItem.key)`，Slack 与 Notion 都支持 connector-level OAuth
- 但 `renderDetailModal()` 内部的 `connectorLevelOauth` 只写成了 `detailItem.key === "notion"`

这会导致 Slack 虽然 OAuth 主链已存在，但在展示层没有真正进入 GitHub 同款卡片模式。

## 5. 设计原则

1. 只改展示层，不改主链逻辑。
2. 只收敛用户入口，不在本轮删除底层兼容能力。
3. 默认单账号/单默认 profile，不向普通用户暴露 Profile 管理复杂度。
4. 指南文案必须与实际实现一致，不能继续出现 token 手工录入引导。

## 6. 交互方案

## 6.1 统一卡片结构

Slack 与 Notion 详情页统一采用与 GitHub 相同的信息层级：

1. 顶部平台图标
2. 平台名称
3. 平台描述
4. 授权状态区
5. 操作按钮区
6. 平台使用指南区

保留现有弹窗容器、尺寸、圆角、按钮体系，不重做整体弹窗布局。

## 6.2 未授权态

展示内容：

- 平台图标、标题、简介
- 单个主按钮：`连接`
- 若当前来自某个 session，则展示“授权成功后将自动挂载到当前会话”的提示

不再展示：

- Profile 选择器
- 新建 profile 按钮
- token / secret 输入框
- “保存 profile”按钮
- token 相关说明文案

点击“连接”后的行为：

- 继续复用现有 `handleOAuth()`
- 继续复用现有 connector-level OAuth start
- 若无 profile，由后端自动创建 `${ConnectorName} Default`

## 6.3 已授权态

展示内容：

- 状态条
  - Slack：`授权账户` + `用户权限`
  - Notion：`已连接 workspace` + `内容访问依赖页面共享`
- 操作按钮
  - 次按钮：`取消授权`
  - 主按钮：`重新连接`

说明：

- “取消授权”继续复用现有清除授权逻辑，不改 detach 主链。
- “重新连接”继续复用现有 OAuth start/callback 主链。
- 不再显示 profile 级别的默认设置、删除 profile、编辑字段等操作。

## 6.4 平台使用指南

卡片下方新增指南模块，但风格保持与 GitHub 当前详情区一致：使用说明卡片、提示条、外链按钮，不增加新的复杂布局体系。

### Slack 指南内容

必须明确：

1. 当前 Slack 授权代表的是用户本人，不是 oneceo bot。
2. 请使用你实际要访问消息/频道的 Slack 账号完成授权。
3. 若授权后看不到频道或消息，优先检查该用户本身是否有访问权限。
4. 若 workspace、scope 或账号切换，需重新连接。

建议展示结构：

- 标题：`Slack 使用指南`
- 3 步说明：
  1. 在 Slack 授权页确认 workspace 与账号
  2. 完成授权并返回 oneceo
  3. 若读取不到内容，先检查用户自身权限再重新授权
- 辅助提示：
  - “这是用户权限，不是 bot 权限”

### Notion 指南内容

必须明确：

1. 完成 OAuth 只代表 integration 已连接成功。
2. 真正要访问某个 page/database，仍需在 Notion 中执行 `Add connections` / 分享给 integration。
3. 如果授权成功但读不到内容，优先判断为共享范围问题，而不是授权失败。
4. 切换 workspace 或权限变化后，需重新连接。

建议展示结构：

- 标题：`Notion 使用指南`
- 3 步说明：
  1. 完成 Notion OAuth 授权
  2. 到目标 page/database 添加该 integration
  3. 返回 oneceo 再使用 Notion MCP
- 辅助提示：
  - “未共享页面时，连接成功也无法读取内容”

## 7. 实现方案

## 7.1 前端主改造文件

文件：`apps/web/client/src/components/ConnectorCenterPanel.tsx`

### 变更点 1：统一卡片型连接器判定

新增统一判定概念，例如：

- GitHub
- Slack
- Notion

这三个连接器统一进入“卡片式 OAuth 展示”分支。

目标：

- 不再让 Slack / Notion 落入通用 Profile 表单渲染分支
- 修正当前仅 `notion` 被识别为 `connectorLevelOauth` 的展示层不一致问题

### 变更点 2：隐藏 Slack / Notion 的通用 Profile 配置区

当前以下内容应从 Slack / Notion 详情页移除：

- Profile 配置标题
- Profile 选择器
- 新建 profile 按钮
- 默认 profile、删除 profile、清除授权等 profile 级操作组
- `detailItem.configFields` 渲染出的输入框
- “保存 profile”按钮

保留：

- 卡片顶部平台信息
- “连接 / 取消授权 / 重新连接”按钮
- target session 挂载提示
- 错误提示区
- 指南说明区

### 变更点 3：Slack / Notion 复用 GitHub 卡片布局

将 GitHub 当前已有的双态卡片结构抽成可复用布局，避免三套相似 JSX 分叉继续增长。

建议抽成内部 helper：

- `renderOauthCardHeader(...)`
- `renderOauthCardActions(...)`
- `renderConnectorGuideSection(...)`

本轮不要求抽成独立文件，只要结构清晰即可。

### 变更点 4：按钮行为保持现有主链

Slack / Notion 的按钮行为继续绑定现有逻辑：

- `连接` -> `handleOAuth()`
- `重新连接` -> `handleOAuth()`
- `取消授权` -> 复用现有清除授权逻辑

要求：

- 不新增新的 API client
- 不改 OAuth state / callback 清理逻辑
- 不改 attach 到 session 的逻辑

## 7.2 指南文案文件

文件：`apps/web/client/src/lib/connector-guides.ts`

### Slack 文案调整

删除以下方向的内容：

- 手工填写 Slack user token
- token 类型说明引导到“可手填”
- 将当前授权链路描述为“也可以手工填 token”

保留并强调：

- User OAuth
- 用户本人权限边界
- workspace/账号确认
- 权限不足时先检查 Slack 自身可见性

### Notion 文案调整

删除以下方向的内容：

- integration secret 直接粘贴
- access token 手动保存
- 把 token 作为主路径的描述

保留并强调：

- OAuth 授权
- page/database 需要共享给 integration
- 连接成功不等于内容已授权

## 7.3 连接器定义元数据

文件：`apps/api/src/connectors/definitions/slack.ts`

### 目标

收敛用户可见元数据，不再为前端暴露 token 录入入口。

### 变更要求

1. 移除 `configFields` 中的 `accessToken` 字段。
2. 文案改成 OAuth-only 语义。
3. 不改现有 OAuth provider、runtime、secret 解密与运行时注入逻辑。

说明：

- 本轮删除的是“用户可见入口”，不是底层历史兼容读取能力。
- 若数据库中仍有旧 secret，本轮不清理、不迁移。

文件：`apps/api/src/connectors/definitions/notion.ts`

### 变更要求

1. 保留 OAuth-only 定义。
2. 去掉任何会让前端继续联想到“手工 token/secret 录入”的描述。
3. `configFields` 若继续保留，仅作为内部 profile 元数据，不再在详情页中展示。

## 8. 测试方案

## 8.1 Web 单测

文件：`apps/web/client/src/tests/connector-center-panel.test.ts`

新增或补充：

1. Slack 被识别为卡片式 OAuth 连接器。
2. Notion 被识别为卡片式 OAuth 连接器。
3. Slack 未授权态不再出现 token 输入框。
4. Notion 未授权态不再出现 profile 选择器与保存按钮。
5. Slack / Notion 点击连接仍走现有 OAuth 分支。
6. `/slack/callback`、`/notion/callback` 回调清理逻辑保持不变。

## 8.2 目录元数据测试

文件：`apps/api/tests/connector-registry.test.ts`

新增或补充：

1. Slack catalog 不再暴露 `accessToken` 配置字段。
2. Notion catalog 仍保持 OAuth 可用性约束不变。

## 8.3 手工验收

1. 打开连接器中心，进入 Slack 详情页：
   - 看不到 token 输入框
   - 看不到 profile 选择器
   - 只看到 GitHub 风格卡片和 Slack 使用指南
2. 打开 Notion 详情页：
   - 看不到 profile 配置表单
   - 只看到 GitHub 风格卡片和 Notion 使用指南
3. 点击“连接”后，仍可正常跳转 OAuth 页面。
4. 回调成功后，仍能自动回到原 session 或 home。
5. session 场景下，仍能自动 attach 到目标会话。

## 9. 验收标准

1. Slack 与 Notion 的详情页视觉层级与 GitHub 卡片一致。
2. Slack 与 Notion 不再向用户暴露 token 授权路径。
3. Slack 与 Notion 不再显示 token 输入框及相关 token 文案。
4. Notion 不再显示通用 Profile 配置块。
5. 平台使用指南与当前 OAuth 主链实现一致。
6. OAuth、回调、session 自动挂载、runtime 使用逻辑保持不变。

## 10. 风险与处理

### 风险 1：历史多 profile 用户的隐藏复杂度

说明：

- 本轮 UI 不再暴露 Slack / Notion 的 profile 选择器
- 若历史上存在多个 profile，界面将默认只围绕默认 profile / 第一个 profile 进行操作

处理：

- 本轮不处理多 profile 管理，只保证主路径简化
- 若后续需要高级入口，另开文档设计

### 风险 2：底层兼容能力仍存在，但用户入口已移除

说明：

- 这是有意设计
- 目标是“删除用户路径”，不是本轮强行改底层存储模型

处理：

- 文案与 UI 全量移除 token 引导
- 底层兼容读取能力先保留，避免产生额外逻辑风险

## 11. 实施顺序

1. 先改 `ConnectorCenterPanel.tsx`，完成卡片式分支收敛。
2. 再改 `connector-guides.ts`，替换 Slack / Notion 指南文案。
3. 再改 Slack / Notion connector definition 的展示性元数据。
4. 最后补单测与最小手工回归。

## 12. 结论

本方案的本质是：

- **不改授权逻辑**
- **只改用户看到的授权路径**
- **把 Slack / Notion 的体验统一收敛到 GitHub 已验证过的卡片模式**

这样可以用最短路径完成产品一致性收敛，同时避免再次引入 token 与 OAuth 并行带来的认知混乱。
