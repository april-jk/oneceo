# 任务创建智能体 UX 设计文档

## 设计目标

为根页面和 /home 页面的新建任务功能创建流畅的对话式体验，实现：
1. 发送任务后，右侧区域平滑过渡到对话页面
2. 显示用户发送的消息和 AI 处理过程
3. 使用流式消息增量显示 AI 回复
4. 根页面直接跳转到 /home 页面并触发相同动画

## 设计原则

### 1. 渐进式展示
- 用户发送消息后，输入区域收缩并移至顶部
- 对话区域从下方展开，创造连续性
- 使用平滑的动画过渡（300-500ms）

### 2. 视觉层次
- 用户消息：右对齐，深色背景
- AI 消息：左对齐，浅色背景
- 系统消息：居中，灰色背景
- 流式消息：逐字显示，带有打字机效果

### 3. 反馈机制
- 发送中：显示加载动画
- 处理中：显示 AI 思考动画
- 完成：显示完成图标
- 错误：显示错误提示

## 页面布局设计

### 初始状态（未发送消息）
```
┌─────────────────────────────────────┐
│  Logo + Title (居中)                 │
│                                     │
│  ┌───────────────────────────────┐  │
│  │                               │  │
│  │  输入框（大）                  │  │
│  │                               │  │
│  │  [工具栏] [发送按钮]           │  │
│  └───────────────────────────────┘  │
│                                     │
│  [快速操作按钮]                     │
└─────────────────────────────────────┘
```

### 对话状态（发送消息后）
```
┌─────────────────────────────────────┐
│  ┌─────────────────────────────┐    │
│  │ 输入框（小） [发送]          │    │
│  └─────────────────────────────┘    │
│  ┌─────────────────────────────┐    │
│  │                             │    │
│  │  对话区域                    │    │
│  │  ┌─────────────────────┐    │    │
│  │  │ 用户消息（右）       │    │    │
│  │  └─────────────────────┘    │    │
│  │  ┌─────────────────────┐    │    │
│  │  │ AI 消息（左）        │    │    │
│  │  │ [流式显示...]        │    │    │
│  │  └─────────────────────┘    │    │
│  │                             │    │
│  └─────────────────────────────┘    │
└─────────────────────────────────────┘
```

## 动画设计

### 1. 输入区域收缩动画
```typescript
// 从大输入框过渡到小输入框
{
  initial: { 
    height: "200px",
    marginTop: "40vh"
  },
  animate: { 
    height: "60px",
    marginTop: "20px"
  },
  transition: {
    duration: 0.4,
    ease: "easeInOut"
  }
}
```

### 2. 对话区域展开动画
```typescript
// 对话区域从下方滑入
{
  initial: { 
    opacity: 0,
    y: 50,
    height: 0
  },
  animate: { 
    opacity: 1,
    y: 0,
    height: "auto"
  },
  transition: {
    duration: 0.4,
    ease: "easeOut",
    delay: 0.2
  }
}
```

### 3. 消息出现动画
```typescript
// 每条消息逐个淡入
{
  initial: { 
    opacity: 0,
    x: -20 // 左侧消息
    // x: 20 // 右侧消息
  },
  animate: { 
    opacity: 1,
    x: 0
  },
  transition: {
    duration: 0.3,
    ease: "easeOut"
  }
}
```

### 4. 流式消息动画
```typescript
// 打字机效果
const TypewriterText = ({ text }: { text: string }) => {
  const [displayText, setDisplayText] = useState("");
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    if (currentIndex < text.length) {
      const timeout = setTimeout(() => {
        setDisplayText(prev => prev + text[currentIndex]);
        setCurrentIndex(prev => prev + 1);
      }, 30); // 30ms per character
      return () => clearTimeout(timeout);
    }
  }, [currentIndex, text]);

  return <span>{displayText}</span>;
};
```

## 组件结构

### TaskCreationPage 组件
```typescript
interface TaskCreationPageState {
  mode: 'input' | 'chat'; // 输入模式 或 对话模式
  messages: Message[];
  isProcessing: boolean;
}
```

### Message 组件
```typescript
interface Message {
  id: string;
  type: 'user' | 'agent' | 'system';
  content: string;
  agent?: string; // 哪个 Agent 发送的
  timestamp: Date;
  isStreaming?: boolean; // 是否正在流式显示
}
```

## 交互流程

### 1. 用户输入并发送
```
用户输入 → 点击发送 → 
  - 输入区域收缩动画（400ms）
  - 用户消息添加到对话区域
  - 对话区域展开动画（400ms，延迟200ms）
  - 显示 AI 处理中动画
```

### 2. AI 响应
```
收到 WebSocket 消息 →
  - 如果是流式消息：逐字显示
  - 如果是完整消息：淡入显示
  - 如果是澄清问题：显示输入框或选项按钮
```

### 3. 用户回答澄清问题
```
用户回答 → 发送 →
  - 回答添加到对话区域
  - 显示 AI 处理中动画
  - 继续流程
```

## 样式规范

### 颜色
- 用户消息背景：`bg-foreground`（深色）
- 用户消息文字：`text-background`（浅色）
- AI 消息背景：`bg-muted`（浅灰）
- AI 消息文字：`text-foreground`（深色）
- 系统消息背景：`bg-accent`（强调色）
- 处理中动画：`text-muted-foreground`

### 圆角
- 消息气泡：`rounded-2xl`
- 输入框：`rounded-3xl`（大）→ `rounded-2xl`（小）
- 按钮：`rounded-xl`

### 间距
- 消息间距：`gap-3`（12px）
- 内边距：`p-4`（16px）
- 外边距：`m-6`（24px）

### 阴影
- 输入框：`shadow-lg` → `shadow-md`
- 消息卡片：`shadow-sm`
- 悬停：`hover:shadow-md`

## 响应式设计

### 桌面端（> 768px）
- 最大宽度：`max-w-3xl`（768px）
- 消息最大宽度：70%
- 双列快速操作按钮

### 移动端（< 768px）
- 全宽布局
- 消息最大宽度：85%
- 单列快速操作按钮
- 输入框高度自适应

## 性能优化

### 1. 虚拟滚动
- 当消息数量 > 50 时启用虚拟滚动
- 只渲染可见区域的消息

### 2. 防抖处理
- 流式消息更新使用 requestAnimationFrame
- 避免频繁的 DOM 更新

### 3. 懒加载
- 历史消息按需加载
- 滚动到顶部时加载更多

## 可访问性

### 键盘导航
- Tab：在输入框和按钮间切换
- Enter：发送消息
- Shift + Enter：换行
- Esc：取消当前操作

### 屏幕阅读器
- 消息添加时播报
- 处理状态变化时播报
- 使用 aria-label 标注按钮

### 焦点管理
- 发送消息后焦点保持在输入框
- 对话区域自动滚动到最新消息

## 错误处理

### WebSocket 断开
```
显示重连提示 →
  - 自动重连（3次尝试）
  - 显示重连进度
  - 失败后显示手动重连按钮
```

### 消息发送失败
```
显示错误提示 →
  - 消息标记为失败
  - 显示重试按钮
  - 点击重试重新发送
```

## 实现优先级

### P0（必须实现）
1. ✅ 输入区域收缩动画
2. ✅ 对话区域展开动画
3. ✅ 消息显示（用户/AI）
4. ✅ 流式消息显示
5. ✅ WebSocket 连接管理

### P1（重要）
1. 🔲 打字机效果优化
2. 🔲 滚动到最新消息
3. 🔲 处理中动画
4. 🔲 错误处理和重试
5. 🔲 根页面跳转

### P2（优化）
1. 🔲 虚拟滚动
2. 🔲 历史消息加载
3. 🔲 消息搜索
4. 🔲 导出对话记录
5. 🔲 自定义主题

## 测试计划

### 单元测试
- 消息组件渲染
- 动画触发条件
- WebSocket 消息处理

### 集成测试
- 完整对话流程
- 错误恢复
- 页面跳转

### E2E 测试
- 用户发送消息
- AI 响应显示
- 澄清问题交互
- 执行计划生成

## 参考设计

### 灵感来源
- ChatGPT 的对话界面
- Claude 的流式响应
- Linear 的输入框过渡
- Notion 的页面动画

### 设计系统
- Swiss International Style（瑞士国际主义风格）
- Digital Minimalism（数字极简主义）
- Material Design 的动画原则
