import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveAdminEnvWritePath } from '../load-env';
import { AppError } from '../utils/errors';

export type AdminThemeKey = string;

export type AdminThemeOption = {
  key: AdminThemeKey;
  label: string;
  family: string;
  variant: string;
  tone: 'light' | 'dark';
  description: string;
  swatches: string[];
};

export type AdminThemeSettings = {
  currentTheme: AdminThemeKey;
  envKey: string;
  envPath: string;
  themes: AdminThemeOption[];
};

const ADMIN_THEME_ENV_KEY = 'ADMIN_MANAGEMENT_THEME';
const DEFAULT_ADMIN_THEME: AdminThemeKey = 'everforest-light';

const ADMIN_THEME_OPTIONS: AdminThemeOption[] = [
  { key: 'github-light', label: 'GitHub Light', family: 'GitHub', variant: 'Light', tone: 'light', description: '清爽浅色，适合白天处理表格和日志。', swatches: ['#f6f8fa', '#24292f', '#0969da'] },
  { key: 'github-dark', label: 'GitHub Dark', family: 'GitHub', variant: 'Dark', tone: 'dark', description: 'GitHub 暗色语义，适合夜间阅读。', swatches: ['#0d1117', '#e6edf3', '#2f81f7'] },
  { key: 'github-dimmed', label: 'GitHub Dimmed', family: 'GitHub', variant: 'Dimmed', tone: 'dark', description: '低对比暗色，减少长时间日志阅读疲劳。', swatches: ['#22272e', '#adbac7', '#539bf5'] },
  { key: 'dracula-classic', label: 'Dracula Classic', family: 'Dracula', variant: 'Classic', tone: 'dark', description: '高对比暗色，适合长时间排障。', swatches: ['#282a36', '#f8f8f2', '#bd93f9'] },
  { key: 'dracula-soft', label: 'Dracula Soft', family: 'Dracula', variant: 'Soft', tone: 'dark', description: '降低紫色饱和度，保留 Dracula 的辨识度。', swatches: ['#2b2d3a', '#f3eefc', '#a98df2'] },
  { key: 'everforest-light', label: 'Everforest Light', family: 'Everforest', variant: 'Light', tone: 'light', description: '柔和绿灰，适合默认运维控制台。', swatches: ['#f3f5f1', '#1f261f', '#16785f'] },
  { key: 'everforest-dark', label: 'Everforest Dark', family: 'Everforest', variant: 'Dark', tone: 'dark', description: '森林暗色，兼顾控制台状态色可读性。', swatches: ['#2b3339', '#d3c6aa', '#a7c080'] },
  { key: 'everforest-hard', label: 'Everforest Hard', family: 'Everforest', variant: 'Hard', tone: 'dark', description: '更深背景，适合大屏值守。', swatches: ['#1e2326', '#d3c6aa', '#83c092'] },
  { key: 'onedark-classic', label: 'One Dark Classic', family: 'One Dark', variant: 'Classic', tone: 'dark', description: '克制暗色，偏工程编辑器风格。', swatches: ['#282c34', '#abb2bf', '#61afef'] },
  { key: 'onedark-pro', label: 'One Dark Pro', family: 'One Dark', variant: 'Pro', tone: 'dark', description: '更强蓝绿强调，适合高频操作界面。', swatches: ['#1f2329', '#d7dae0', '#4fa6ed'] },
  { key: 'catppuccin-latte', label: 'Catppuccin Latte', family: 'Catppuccin', variant: 'Latte', tone: 'light', description: '柔和浅色，保留 Catppuccin 的粉彩强调。', swatches: ['#eff1f5', '#4c4f69', '#8839ef'] },
  { key: 'catppuccin-macchiato', label: 'Catppuccin Macchiato', family: 'Catppuccin', variant: 'Macchiato', tone: 'dark', description: '中等暗度，适合日夜混合使用。', swatches: ['#24273a', '#cad3f5', '#c6a0f6'] },
  { key: 'catppuccin-mocha', label: 'Catppuccin Mocha', family: 'Catppuccin', variant: 'Mocha', tone: 'dark', description: '温和暗色，低疲劳阅读。', swatches: ['#1e1e2e', '#cdd6f4', '#cba6f7'] },
  { key: 'tokyo-night-day', label: 'Tokyo Night Day', family: 'Tokyo Night', variant: 'Day', tone: 'light', description: 'Tokyo Night 的浅色变体，适合白天办公。', swatches: ['#e1e2e7', '#3760bf', '#2e7de9'] },
  { key: 'tokyo-night-storm', label: 'Tokyo Night Storm', family: 'Tokyo Night', variant: 'Storm', tone: 'dark', description: '灰蓝暗色，适合控制台密集信息。', swatches: ['#24283b', '#c0caf5', '#7aa2f7'] },
  { key: 'tokyo-night-night', label: 'Tokyo Night Night', family: 'Tokyo Night', variant: 'Night', tone: 'dark', description: '深夜蓝黑，突出状态色和代码块。', swatches: ['#1a1b26', '#c0caf5', '#7aa2f7'] },
  { key: 'nord-polar-night', label: 'Nord Polar Night', family: 'Nord', variant: 'Polar Night', tone: 'dark', description: '冷静蓝灰，适合低饱和监控界面。', swatches: ['#2e3440', '#d8dee9', '#88c0d0'] },
  { key: 'nord-frost', label: 'Nord Frost', family: 'Nord', variant: 'Frost', tone: 'light', description: 'Nord 的浅色霜感变体。', swatches: ['#eceff4', '#2e3440', '#5e81ac'] },
  { key: 'solarized-light', label: 'Solarized Light', family: 'Solarized', variant: 'Light', tone: 'light', description: '经典低对比浅色，适合长文档阅读。', swatches: ['#fdf6e3', '#586e75', '#268bd2'] },
  { key: 'solarized-dark', label: 'Solarized Dark', family: 'Solarized', variant: 'Dark', tone: 'dark', description: '经典低对比暗色，适合长时间终端风工作。', swatches: ['#002b36', '#93a1a1', '#268bd2'] },
  { key: 'gruvbox-light', label: 'Gruvbox Light', family: 'Gruvbox', variant: 'Light', tone: 'light', description: '复古暖色浅色，适合低刺激阅读。', swatches: ['#fbf1c7', '#3c3836', '#b57614'] },
  { key: 'gruvbox-dark', label: 'Gruvbox Dark', family: 'Gruvbox', variant: 'Dark', tone: 'dark', description: '复古暗色，高辨识度状态色。', swatches: ['#282828', '#ebdbb2', '#fabd2f'] },
  { key: 'gruvbox-material', label: 'Gruvbox Material', family: 'Gruvbox', variant: 'Material', tone: 'dark', description: '更柔和的 Gruvbox 暗色变体。', swatches: ['#1d2021', '#ddc7a1', '#a9b665'] },
  { key: 'monokai-classic', label: 'Monokai Classic', family: 'Monokai', variant: 'Classic', tone: 'dark', description: '经典高对比代码主题。', swatches: ['#272822', '#f8f8f2', '#a6e22e'] },
  { key: 'monokai-pro', label: 'Monokai Pro', family: 'Monokai', variant: 'Pro', tone: 'dark', description: '更现代的 Monokai 暗色控制台。', swatches: ['#2d2a2e', '#fcfcfa', '#ffd866'] },
  { key: 'material-ocean', label: 'Material Ocean', family: 'Material', variant: 'Ocean', tone: 'dark', description: 'Material 深海蓝，适合监控大屏。', swatches: ['#0f111a', '#b8c6db', '#82aaff'] },
  { key: 'material-palenight', label: 'Material Palenight', family: 'Material', variant: 'Palenight', tone: 'dark', description: '柔和蓝紫暗色，适合夜间后台。', swatches: ['#292d3e', '#a6accd', '#c792ea'] },
  { key: 'material-lighter', label: 'Material Lighter', family: 'Material', variant: 'Lighter', tone: 'light', description: 'Material 浅色，高可读表格体验。', swatches: ['#fafafa', '#546e7a', '#00bcd4'] },
  { key: 'ayu-light', label: 'Ayu Light', family: 'Ayu', variant: 'Light', tone: 'light', description: '干净浅色，突出金色操作焦点。', swatches: ['#fafafa', '#5c6773', '#ff9940'] },
  { key: 'ayu-mirage', label: 'Ayu Mirage', family: 'Ayu', variant: 'Mirage', tone: 'dark', description: '不太深的暗色，适合昼夜切换。', swatches: ['#1f2430', '#cbccc6', '#ffcc66'] },
  { key: 'ayu-dark', label: 'Ayu Dark', family: 'Ayu', variant: 'Dark', tone: 'dark', description: '深色 Ayu，适合专注编辑。', swatches: ['#0f1419', '#bfbdb6', '#ffb454'] },
  { key: 'rose-pine-dawn', label: 'Rose Pine Dawn', family: 'Rose Pine', variant: 'Dawn', tone: 'light', description: '柔和浅色，减少后台的冷硬感。', swatches: ['#faf4ed', '#575279', '#d7827e'] },
  { key: 'rose-pine-moon', label: 'Rose Pine Moon', family: 'Rose Pine', variant: 'Moon', tone: 'dark', description: '中深玫瑰暗色，适合信息面板。', swatches: ['#232136', '#e0def4', '#c4a7e7'] },
  { key: 'rose-pine-main', label: 'Rose Pine Main', family: 'Rose Pine', variant: 'Main', tone: 'dark', description: '经典 Rose Pine 暗色。', swatches: ['#191724', '#e0def4', '#ebbcba'] },
  { key: 'kanagawa-lotus', label: 'Kanagawa Lotus', family: 'Kanagawa', variant: 'Lotus', tone: 'light', description: '水墨浅色，适合白天管理任务。', swatches: ['#f2ecbc', '#545464', '#b35b79'] },
  { key: 'kanagawa-wave', label: 'Kanagawa Wave', family: 'Kanagawa', variant: 'Wave', tone: 'dark', description: '经典 Kanagawa 暗色。', swatches: ['#1f1f28', '#dcd7ba', '#7e9cd8'] },
  { key: 'kanagawa-dragon', label: 'Kanagawa Dragon', family: 'Kanagawa', variant: 'Dragon', tone: 'dark', description: '更深的水墨暗色，适合夜间值守。', swatches: ['#181616', '#c5c9c5', '#8ba4b0'] },
  { key: 'synthwave-84', label: 'SynthWave 84', family: 'SynthWave', variant: '84', tone: 'dark', description: '霓虹复古暗色，适合个性化后台。', swatches: ['#262335', '#f92aad', '#72f1b8'] },
  { key: 'synthwave-dim', label: 'SynthWave Dim', family: 'SynthWave', variant: 'Dim', tone: 'dark', description: '降低霓虹亮度，兼顾可读性。', swatches: ['#241b2f', '#f6d5ff', '#36f9f6'] },
  { key: 'night-owl', label: 'Night Owl', family: 'Night Owl', variant: 'Dark', tone: 'dark', description: '夜间编码经典主题，高可读蓝色调。', swatches: ['#011627', '#d6deeb', '#82aaff'] },
  { key: 'night-owl-light', label: 'Night Owl Light', family: 'Night Owl', variant: 'Light', tone: 'light', description: 'Night Owl 的浅色变体。', swatches: ['#fbfbfb', '#403f53', '#4876d6'] },
  { key: 'arc-light', label: 'Arc Light', family: 'Arc', variant: 'Light', tone: 'light', description: '现代 Linux 风浅色。', swatches: ['#f5f6f7', '#2f343f', '#5294e2'] },
  { key: 'arc-dark', label: 'Arc Dark', family: 'Arc', variant: 'Dark', tone: 'dark', description: '现代 Linux 风暗色。', swatches: ['#2f343f', '#d3dae3', '#5294e2'] },
];

const ADMIN_THEME_KEYS = new Set(ADMIN_THEME_OPTIONS.map((item) => item.key));
const ADMIN_THEME_ALIASES = new Map<string, AdminThemeKey>([
  ['github', 'github-light'],
  ['dracula', 'dracula-classic'],
  ['everforest', 'everforest-light'],
  ['onedark', 'onedark-classic'],
  ['catppuccin', 'catppuccin-mocha'],
  ['tokyo-night', 'tokyo-night-night'],
  ['nord', 'nord-polar-night'],
  ['solarized', 'solarized-light'],
  ['gruvbox', 'gruvbox-dark'],
  ['monokai', 'monokai-classic'],
  ['material', 'material-ocean'],
  ['ayu', 'ayu-mirage'],
  ['rose-pine', 'rose-pine-main'],
  ['kanagawa', 'kanagawa-wave'],
  ['synthwave', 'synthwave-84'],
  ['night-owl-dark', 'night-owl'],
  ['arc', 'arc-light'],
]);

function normalizeThemeKey(value: unknown): AdminThemeKey {
  const key = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (ADMIN_THEME_ALIASES.has(key)) {
    return ADMIN_THEME_ALIASES.get(key) || DEFAULT_ADMIN_THEME;
  }
  if (ADMIN_THEME_KEYS.has(key as AdminThemeKey)) {
    return key as AdminThemeKey;
  }
  return DEFAULT_ADMIN_THEME;
}

function replaceEnvValue(raw: string, key: string, value: string) {
  const newline = raw.includes('\r\n') ? '\r\n' : '\n';
  const lines = raw ? raw.split(/\r?\n/) : [];
  let replaced = false;
  const keyPattern = new RegExp(`^\\s*${key}\\s*=`);
  const nextLines = lines.map((line) => {
    if (!keyPattern.test(line)) return line;
    replaced = true;
    return `${key}=${value}`;
  });

  if (replaced) {
    return nextLines.join(newline);
  }

  const prefix = raw && !raw.endsWith('\n') && !raw.endsWith('\r\n') ? newline : '';
  const section = raw ? `${prefix}${newline}# Admin Management UI${newline}` : '# Admin Management UI\n';
  return `${raw}${section}${key}=${value}${newline}`;
}

export class AdminThemeService {
  getSettings(): AdminThemeSettings {
    return {
      currentTheme: normalizeThemeKey(process.env[ADMIN_THEME_ENV_KEY]),
      envKey: ADMIN_THEME_ENV_KEY,
      envPath: resolveAdminEnvWritePath(),
      themes: ADMIN_THEME_OPTIONS,
    };
  }

  async updateTheme(themeKey: string): Promise<AdminThemeSettings> {
    const normalizedTheme = normalizeThemeKey(themeKey);
    if (normalizedTheme !== themeKey.trim().toLowerCase()) {
      throw new AppError(400, `不支持的主题: ${themeKey}`);
    }

    const envPath = resolveAdminEnvWritePath();
    await fs.mkdir(path.dirname(envPath), { recursive: true });
    const raw = await fs.readFile(envPath, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return '';
      throw error;
    });
    await fs.writeFile(envPath, replaceEnvValue(raw, ADMIN_THEME_ENV_KEY, normalizedTheme), 'utf8');
    process.env[ADMIN_THEME_ENV_KEY] = normalizedTheme;
    return this.getSettings();
  }
}
