---
name: oneceo
description: AI Agent 项目管理与平台治理的任务塔台界面系统
colors:
  command-blue: "#0969da"
  command-blue-strong: "#0550ae"
  rail-ink: "#1f2328"
  rail-soft: "#30363d"
  console-bg: "#f6f8fa"
  console-bg-soft: "#edf1f5"
  surface: "#f9fbfd"
  surface-muted: "#f2f5f8"
  text: "#1f2328"
  text-soft: "#57606a"
  text-faint: "#6b7480"
  audit-amber: "#9a6700"
  danger-red: "#cf222e"
  success-green: "#2f8f68"
typography:
  display:
    fontFamily: "IBM Plex Sans, Noto Sans SC, Segoe UI, sans-serif"
    fontSize: "clamp(2.15rem, 4vw, 4rem)"
    fontWeight: 700
    lineHeight: 0.98
    letterSpacing: "-0.045em"
  headline:
    fontFamily: "IBM Plex Sans, Noto Sans SC, Segoe UI, sans-serif"
    fontSize: "18px"
    fontWeight: 800
    lineHeight: 1.2
  title:
    fontFamily: "IBM Plex Sans, Noto Sans SC, Segoe UI, sans-serif"
    fontSize: "14px"
    fontWeight: 850
    lineHeight: 1.25
  body:
    fontFamily: "IBM Plex Sans, Noto Sans SC, Segoe UI, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.42
  label:
    fontFamily: "Noto Sans SC, IBM Plex Sans, Segoe UI, sans-serif"
    fontSize: "12px"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "0.04em"
  mono:
    fontFamily: "Fira Code, SFMono-Regular, Consolas, monospace"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.42
rounded:
  sm: "8px"
  md: "9px"
  lg: "12px"
  xl: "14px"
  pill: "999px"
spacing:
  xs: "6px"
  sm: "8px"
  md: "12px"
  lg: "18px"
  xl: "20px"
components:
  button-primary:
    backgroundColor: "{colors.command-blue}"
    textColor: "#f6fbff"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "0 13px"
    height: "34px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "0 13px"
    height: "34px"
  status-badge:
    backgroundColor: "{colors.surface-muted}"
    textColor: "{colors.text-soft}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0 9px"
    height: "23px"
  detail-shell:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
    padding: "18px 20px"
  input-control:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "8px 11px"
    height: "36px"
---

# Design System: oneceo

## 1. Overview

**Creative North Star: "任务塔台"**

oneceo 的界面像任务塔台，不像营销展厅。它面向平台管理员的多路值守场景：用户、会话、Sandbox、部署、技能、连接器、计费和审计同时存在，界面必须让状态、风险和下一步动作在第一屏内被快速判断。

视觉系统采用结构性层级：浅色 GitHub 基底、深色 rail、蓝色指令色和少量语义色共同建立秩序。阴影服务于前景面板和危险确认，边框、色调层和粘性检查器承担日常密度。它拒绝通用 AI SaaS 模板，也拒绝传统后台的灰白堆叠。

**Key Characteristics:**
- 高密度但有扫描路径，优先让用户判断状态和后果。
- 指令色稀缺，蓝色只给主动作、焦点、活跃状态和关键关系。
- 组件紧凑、确定、可复核，危险动作必须带对象和影响说明。
- 主题可切换，但默认设计语言仍是工程化、冷静、可值守。

## 2. Colors

颜色是工程信号，不是装饰。默认采用 GitHub Light 风格的浅色控制台，深色 rail 提供定位，蓝色表达指令，琥珀、红色、绿色只表达状态语义。

### Primary
- **Command Blue** (`command-blue`): 主动作、焦点环、活跃标签、关系节点和可点击控制的唯一高权重指令色。
- **Command Blue Strong** (`command-blue-strong`): 主按钮渐变终点、hover 强化和深色主题中的高对比控制色。

### Secondary
- **Rail Ink** (`rail-ink`): 侧边栏、遮罩、强文字和前景投影的结构锚点。
- **Rail Soft** (`rail-soft`): 深色 rail 的次级层，适合导航 hover、分组背景和阴影来源。

### Tertiary
- **Audit Amber** (`audit-amber`): 等待、归档、暂停、处理中和需要复核的状态。
- **Danger Red** (`danger-red`): 删除、关闭、失败、撤销和不可逆操作。
- **Success Green** (`success-green`): 运行中、已完成、已发布、已验证等正向状态。

### Neutral
- **Console Background** (`console-bg`): 应用底色，承载高密度表格和管理工作台。
- **Console Background Soft** (`console-bg-soft`): 页面纵深和低权重分区。
- **Surface** (`surface`): 详情壳、表单、按钮和卡片的主承载面。
- **Surface Muted** (`surface-muted`): 键值块、代码外围、弱提示和中性状态背景。
- **Text** (`text`): 主文本和关键数据。
- **Text Soft** (`text-soft`): 描述、元信息和次要标签。
- **Text Faint** (`text-faint`): eyebrow、时间戳、辅助说明和表头标签。

### Named Rules
**The Command Color Rule.** 蓝色只能表示可执行、已选中、聚焦或关系锚点。不要把蓝色当成装饰填充。

**The Semantic State Rule.** 琥珀、红色、绿色必须绑定真实状态或风险，不允许用于普通视觉点缀。

## 3. Typography

**Display Font:** IBM Plex Sans, with Noto Sans SC and Segoe UI fallback  
**Body Font:** IBM Plex Sans, with Noto Sans SC and Segoe UI fallback  
**Label/Mono Font:** Noto Sans SC for dense labels, Fira Code for ids, logs, paths and code

**Character:** 字体系统技术感明确但不冷漠。中文标签用高权重和小字号建立扫描锚点，英文与代码信息通过 Fira Code 保持等宽可信度。

### Hierarchy
- **Display** (700, `clamp(2.15rem, 4vw, 4rem)`, 0.98): 只用于登录页或极少数品牌化入口，不进入常规后台密度区。
- **Headline** (800, `18px`, 1.2): 详情壳标题、抽屉标题和危险确认标题。
- **Title** (850, `14px`, 1.25): 分区标题、指标标题、关系节点主文本。
- **Body** (400 to 650, `14px`, 1.42): 页面正文、表单内容和说明文字，长说明控制在 65 至 75ch。
- **Label** (800 to 900, `11px` to `12px`, `0.04em` to `0.06em`, uppercase where useful): eyebrow、标签、表头、状态类别和键值名。

### Named Rules
**The Scan First Rule.** 管理后台标题不靠大字号取胜，靠权重、标签、间距和位置形成扫描路径。

**The Code Is Evidence Rule.** id、路径、日志和版本号使用等宽字体，不要用普通正文样式弱化它们的证据属性。

## 4. Elevation

oneceo 使用结构性层级：默认界面靠色调、边框、sticky inspector 和 8px 至 14px 圆角建立秩序；阴影只在前景对象出现，包括详情壳、抽屉、危险确认、登录视觉面板和主按钮 hover。常规内容块不要凭空漂浮。

### Shadow Vocabulary
- **Page Shadow** (`0 24px 50px color-mix(in srgb, var(--theme-rail) 10%, transparent)`): 页面级面板或主要 shell。
- **Soft Shadow** (`0 10px 24px color-mix(in srgb, var(--theme-rail) 8%, transparent)`): 移动卡片、小型前景块和代码面板。
- **Dialog Shadow** (`0 28px 80px color-mix(in srgb, var(--theme-rail) 18%, transparent), 0 4px 14px color-mix(in srgb, var(--theme-rail) 10%, transparent)`): 详情壳、diff 抽屉、危险确认。
- **Command Hover Shadow** (`0 10px 24px color-mix(in srgb, var(--admin-ui-blue) 30%, transparent)`): 主按钮 hover，不用于普通卡片。

### Named Rules
**The Foreground Only Rule.** 阴影表示前景层级或响应状态，不表示“好看”。如果一个块没有遮挡、确认或焦点意义，就用边框和色调层。

## 5. Components

组件气质是紧凑、确定、可复核。它们服务于管理员的判断链路，而不是制造视觉噪声。

### Buttons
- **Shape:** 紧凑矩形圆角（8px），高度 28px、34px、40px 三档。
- **Primary:** Command Blue 渐变，白蓝 tinted 文本，12px 到 13px 粗体标签，hover 只增加蓝色阴影。
- **Hover / Focus:** hover 改变背景或阴影；focus-visible 使用 2px 蓝色 outline 和 2px offset，不能只靠颜色变化。
- **Secondary / Ghost / Tertiary:** Secondary 使用浅色 surface 和弱蓝边框；Ghost 透明且只在 hover 出现蓝色软底；Link 仅用于低风险文本动作。
- **Danger:** 实心红用于不可逆动作；dangerSoft 用于危险区内的次级动作。

### Chips
- **Style:** pill 圆角（999px），23px 高，12px 粗体，状态点 7px。
- **State:** success、info、warning、processing、danger、neutral 必须来自真实数据状态；warning 与 processing 共用琥珀基调。

### Cards / Containers
- **Corner Style:** 常规信息块 10px 至 12px，抽屉 14px，登录页大面板 24px。
- **Background:** 默认使用 Surface 或 Surface Muted，重要详情壳可用浅蓝 fog 混合。
- **Shadow Strategy:** 普通块无投影；前景详情壳、diff 抽屉和危险确认使用 Dialog Shadow。
- **Border:** 1px 半透明边框是主要分隔手段，禁止用粗侧边条表达状态。
- **Internal Padding:** 细密块 10px 至 12px，详情区 14px，shell body 18px 20px。

### Inputs / Fields
- **Style:** 36px 最小高度，9px 圆角，浅色渐变背景，13px 半粗体，内阴影表示可输入面。
- **Focus:** 蓝色边框加 3px 软 ring，并保留内部高光。
- **Error / Disabled:** error 使用红色边框和红色软底；disabled 降低透明度、移除阴影、显示不可用指针。

### Navigation
- **Style, typography, default/hover/active states, mobile treatment.** 主侧边栏承担系统地图，active 通过浅蓝底、边框和高权重文本表达，不能只靠图标颜色。移动端让关键操作全宽排列，详情壳宽度收敛到 100vw，底部操作区纵向堆叠。

### Signature Component: Admin Detail Shell

Admin Detail Shell 是管理后台的指挥台容器。它由 header、summary、tabs、body、footer 五段组成，支持命令图标、指标组、sticky inspector、危险区和 diff 抽屉。它必须让对象身份、状态、影响、下一步动作同时可见。

### Signature Component: Diff Drawer

Diff Drawer 是提交前复核层。它固定在右侧，宽度不超过 680px，使用 Dialog Shadow，字段变化以 added、removed、changed 的语义边框表达。它不能退化为普通弹窗。

## 6. Do's and Don'ts

### Do:
- **Do** 使用 `command-blue` 表达主动作、聚焦、已选中和关系锚点，并保持稀缺。
- **Do** 用 1px 边框、浅色 surface、sticky inspector 和明确标题建立密度秩序。
- **Do** 在危险操作中展示对象、后果、可恢复边界和确认动作。
- **Do** 保留等宽字体给 id、路径、版本、日志和代码，保持证据感。
- **Do** 为 WCAG AA 保持焦点态、对比度和键盘路径，状态不能只靠颜色表达。

### Don't:
- **Don't** 做成通用 AI SaaS 模板：禁止渐变文字、英雄大数字、无差别卡片网格、抽象光效和空洞口号。
- **Don't** 做成传统后台：禁止老式 ERP 的灰白表格堆叠、低信息层级、模糊按钮和缺少后果说明的弹窗。
- **Don't** 用 `border-left` 或 `border-right` 大于 1px 的彩色侧边条表达卡片、告警、列表项或状态。
- **Don't** 把玻璃拟态、背景 blur 或霓虹色作为默认风格；blur 只允许服务于遮罩前景关系。
- **Don't** 为普通内容块添加悬浮阴影。没有前景意义的块必须保持结构性层级。
