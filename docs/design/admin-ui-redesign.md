# 管理后台 UI 重构设计文档 [20250420-已采用]

## 1. 设计方向

**美学方向：Editorial Dashboard（编辑式仪表板）**

融合高端杂志排版美学与瑞士国际主义设计的精确性。针对管理员高频操作、长时间值守的场景，追求"信息密度与视觉呼吸感并存"。

## 2. 字体系统

| 用途 | 字体 | 来源 |
|------|------|------|
| Display/标题 | **Newsreader** | Google Fonts（优雅衬线，编辑感） |
| Body/正文 | **DM Sans** | Google Fonts（人文主义无衬线） |
| Mono/代码 | **JetBrains Mono** | Google Fonts |
| 中文回退 | "Noto Sans SC" | Google Fonts |

## 3. 色彩系统

4 套主题，每套含亮/暗模式。基于 CSS 变量实现运行时切换。

### Rose Pine（默认）
- Light: 暖白底 `#faf4ed` + 紫棕文字 `#575279` + 玫瑰强调 `#b4637a`
- Dark: 深紫底 `#191724` + 淡紫文字 `#e0def4` + 淡紫强调 `#c4a7e7`

### Forest
- Light: 米白底 `#f5f5f0` + 深绿文字 `#2d3a2d` + 苔藓绿强调 `#5a7d5a`
- Dark: 深森底 `#1a1f1a` + 薄荷文字 `#d4e8d4` + 翡翠强调 `#6b9b6b`

### Ocean
- Light: 雪白底 `#f0f4f8` + 深海文字 `#1e3a5f` + 天蓝强调 `#3a7bd5`
- Dark: 深夜底 `#0f1729` + 月光文字 `#c5d5e8` + 冰蓝强调 `#5ba8f7`

### Ember
- Light: 暖白底 `#faf6f0` + 深棕文字 `#3d2b1f` + 琥珀强调 `#c17f3e`
- Dark: 深炭底 `#1a1510` + 暖沙文字 `#e8ddd0` + 铜橙强调 `#d4955a`

## 4. 布局系统

- **侧边栏**: 固定左侧，可折叠为纯图标栏（60px）
- **顶部栏**: 固定，无背景模糊，底部 1px 边框分隔
- **主区域**: 最大内容宽度 1400px，居中，充裕的内边距
- **间距系统**: 4px 基准（4/8/12/16/24/32/48/64）
- **圆角系统**: 小 6px / 中 10px / 大 16px

## 5. 组件风格

### 按钮
- Primary: 实心主题色，hover 时轻微加深，无位移
- Secondary: 透明底 + 1px 边框，hover 时背景淡色
- Ghost: 纯文字，hover 时背景淡色
- 统一圆角 8px，min-height 36px

### 表格
- 表头: 小字号 + 大写 tracking + 底部边框
- 行: hover 时整行背景色变化
- 无纵向边框，仅用间距和横向边框分隔
- 状态列用 6px 圆点 + 文字

### 卡片/面板
- 1px 边框（`--border`）+ 白色/暗色背景
- 无阴影或极淡阴影（仅在暗色模式使用）
- 圆角 10px

### 输入框
- 1px 边框，focus 时 2px 主题色边框 + 无 outline
- 圆角 8px
- 背景与表面色一致

### Toast
- 右侧滑入，圆角 10px
- 图标 + 标题 + 描述
- 自动消失

## 6. 动画系统

- 页面加载: staggered fade-in（0.05s 间隔）
- 侧边栏切换: width transition 250ms ease
- Hover: background-color 150ms ease，无 transform
- Toast: translateX + opacity 300ms ease-out
- Modal: opacity + scale(0.98→1) 200ms ease

## 7. 暗色模式策略

- 非简单反色，而是独立调色
- 背景色不过于深沉（避免纯黑 `#000`）
- 边框色在暗模式下更亮（反直觉但有效）
- 文字对比度保持 WCAG AA

## 8. 改造范围

**修改文件**:
- `web/src/styles.css` — 全面重写视觉系统（保留组件布局类名）
- `web/src/App.tsx` — 最小修改（侧边栏品牌区域、导航标签简化）

**不修改**:
- 所有业务逻辑、状态管理、API 调用
- 子组件内部结构（SkillManagementSection 等）
- types.ts、api.ts

## 9. 实现检查清单

- [ ] 新字体加载
- [ ] 4 套主题 × 2 模式 CSS 变量
- [ ] 侧边栏重构（可折叠）
- [ ] 顶部栏重构
- [ ] 按钮系统
- [ ] 表格系统
- [ ] 卡片/面板系统
- [ ] 输入框系统
- [ ] Toast 系统
- [ ] Modal 系统
- [ ] 加载/空状态
- [ ] 暗色模式验证
- [ ] 构建通过
