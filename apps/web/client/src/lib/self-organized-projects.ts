export type SelfOrganizedEmployeeStatus = "idle" | "busy" | "offline";
export type SelfOrganizedProjectStatus = "active" | "completed" | "paused";

export type SelfOrganizedEmployee = {
  id: string;
  managerId: string;
  name: string;
  skills: string[];
  status: SelfOrganizedEmployeeStatus;
  currentTask?: string;
};

export type SelfOrganizedTask = {
  id: string;
  name: string;
  status: "pending" | "in_progress" | "completed";
};

export type SelfOrganizedManager = {
  id: string;
  projectId: string;
  type: string;
  name: string;
  description?: string;
  employees: SelfOrganizedEmployee[];
  tasks: SelfOrganizedTask[];
};

export type SelfOrganizedProject = {
  id: string;
  name: string;
  description: string;
  progress: number;
  status: SelfOrganizedProjectStatus;
  managers: SelfOrganizedManager[];
};

export const SELF_ORGANIZED_PROJECTS: SelfOrganizedProject[] = [
  {
    id: "1",
    name: "E-commerce Platform",
    description: "构建完整的电商平台，包含前端、后端和数据库",
    progress: 65,
    status: "active",
    managers: [
      {
        id: "m1",
        projectId: "1",
        type: "开发经理",
        name: "Development Manager",
        description: "负责所有开发工作的协调和管理",
        tasks: [
          { id: "t1", name: "实现购物车功能", status: "in_progress" },
          { id: "t2", name: "开发支付 API", status: "in_progress" },
          { id: "t3", name: "数据库优化", status: "completed" },
        ],
        employees: [
          {
            id: "e1",
            managerId: "m1",
            name: "Frontend Developer Agent",
            skills: ["React", "TypeScript", "Tailwind CSS"],
            status: "busy",
            currentTask: "实现购物车功能",
          },
          {
            id: "e2",
            managerId: "m1",
            name: "Backend Developer Agent",
            skills: ["Node.js", "Express", "PostgreSQL"],
            status: "busy",
            currentTask: "开发支付 API",
          },
          {
            id: "e3",
            managerId: "m1",
            name: "Database Agent",
            skills: ["PostgreSQL", "Redis", "MongoDB"],
            status: "idle",
          },
        ],
      },
      {
        id: "m2",
        projectId: "1",
        type: "设计经理",
        name: "Design Manager",
        description: "负责用户体验和界面设计",
        tasks: [
          { id: "t4", name: "设计产品详情页", status: "in_progress" },
          { id: "t5", name: "体验评审", status: "pending" },
        ],
        employees: [
          {
            id: "e4",
            managerId: "m2",
            name: "UI Designer Agent",
            skills: ["Figma", "Sketch", "Adobe XD"],
            status: "busy",
            currentTask: "设计产品详情页",
          },
          {
            id: "e5",
            managerId: "m2",
            name: "UX Researcher Agent",
            skills: ["User Testing", "Analytics", "Wireframing"],
            status: "idle",
          },
        ],
      },
      {
        id: "m3",
        projectId: "1",
        type: "QA 经理",
        name: "QA Manager",
        description: "负责质量保证和测试",
        tasks: [
          { id: "t6", name: "编写单元测试", status: "in_progress" },
          { id: "t7", name: "自动化回归", status: "pending" },
        ],
        employees: [
          {
            id: "e6",
            managerId: "m3",
            name: "Test Engineer Agent",
            skills: ["Jest", "Cypress", "Testing Library"],
            status: "busy",
            currentTask: "编写单元测试",
          },
          {
            id: "e7",
            managerId: "m3",
            name: "Automation Agent",
            skills: ["Selenium", "Puppeteer", "Playwright"],
            status: "idle",
          },
          {
            id: "e8",
            managerId: "m3",
            name: "Performance Tester Agent",
            skills: ["JMeter", "Lighthouse", "WebPageTest"],
            status: "offline",
          },
        ],
      },
    ],
  },
  {
    id: "2",
    name: "Mobile App Development",
    description: "开发跨平台移动应用",
    progress: 40,
    status: "active",
    managers: [
      {
        id: "m4",
        projectId: "2",
        type: "开发经理",
        name: "Mobile Development Manager",
        description: "负责移动端开发",
        tasks: [
          { id: "t8", name: "实现登录功能", status: "in_progress" },
          { id: "t9", name: "实现推送通知", status: "in_progress" },
        ],
        employees: [
          {
            id: "e9",
            managerId: "m4",
            name: "iOS Developer Agent",
            skills: ["Swift", "SwiftUI", "UIKit"],
            status: "busy",
            currentTask: "实现登录功能",
          },
          {
            id: "e10",
            managerId: "m4",
            name: "Android Developer Agent",
            skills: ["Kotlin", "Jetpack Compose", "Android SDK"],
            status: "busy",
            currentTask: "实现推送通知",
          },
          {
            id: "e11",
            managerId: "m4",
            name: "API Developer Agent",
            skills: ["REST", "GraphQL", "WebSocket"],
            status: "idle",
          },
        ],
      },
      {
        id: "m5",
        projectId: "2",
        type: "设计经理",
        name: "Mobile Design Manager",
        description: "负责移动端设计",
        tasks: [
          { id: "t10", name: "设计用户引导流程", status: "in_progress" },
          { id: "t11", name: "图标系统整理", status: "pending" },
        ],
        employees: [
          {
            id: "e12",
            managerId: "m5",
            name: "Mobile Designer Agent",
            skills: ["Figma", "Principle", "Protopie"],
            status: "busy",
            currentTask: "设计用户引导流程",
          },
          {
            id: "e13",
            managerId: "m5",
            name: "Icon Designer Agent",
            skills: ["Illustrator", "Sketch", "Icon Design"],
            status: "idle",
          },
        ],
      },
    ],
  },
  {
    id: "3",
    name: "Marketing Campaign",
    description: "市场营销活动策划和执行",
    progress: 90,
    status: "active",
    managers: [
      {
        id: "m6",
        projectId: "3",
        type: "市场调研经理",
        name: "Market Research Manager",
        description: "负责市场调研和分析",
        tasks: [
          { id: "t12", name: "分析竞争对手", status: "in_progress" },
          { id: "t13", name: "行业趋势复盘", status: "pending" },
        ],
        employees: [
          {
            id: "e14",
            managerId: "m6",
            name: "Market Analyst Agent",
            skills: ["Data Analysis", "Trends", "Forecasting"],
            status: "busy",
            currentTask: "分析竞争对手",
          },
          {
            id: "e15",
            managerId: "m6",
            name: "Competitor Research Agent",
            skills: ["SWOT", "Benchmarking", "Industry Analysis"],
            status: "idle",
          },
        ],
      },
      {
        id: "m7",
        projectId: "3",
        type: "运营经理",
        name: "Operations Manager",
        description: "负责内容创作和社交媒体运营",
        tasks: [
          { id: "t14", name: "撰写博客文章", status: "in_progress" },
          { id: "t15", name: "发布社交媒体内容", status: "in_progress" },
        ],
        employees: [
          {
            id: "e16",
            managerId: "m7",
            name: "Content Creator Agent",
            skills: ["Copywriting", "SEO", "Content Strategy"],
            status: "busy",
            currentTask: "撰写博客文章",
          },
          {
            id: "e17",
            managerId: "m7",
            name: "Social Media Agent",
            skills: ["Twitter", "LinkedIn", "Instagram"],
            status: "busy",
            currentTask: "发布社交媒体内容",
          },
        ],
      },
    ],
  },
];
