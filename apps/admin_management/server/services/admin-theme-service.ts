import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveAdminEnvWritePath } from '../load-env';

export type AdminThemeKey = string;
export type AdminThemeMode = 'light' | 'dark' | 'system';

export type AdminThemeOption = {
  key: AdminThemeKey;
  label: string;
  description: string;
  lightSwatches: string[];
  darkSwatches: string[];
};

export type AdminThemeModeOption = {
  key: AdminThemeMode;
  label: string;
  description: string;
};

export type AdminThemeSettings = {
  currentTheme: AdminThemeKey;
  currentMode: AdminThemeMode;
  envKey: string;
  envModeKey: string;
  envPath: string;
  themes: AdminThemeOption[];
  modes: AdminThemeModeOption[];
};

const ADMIN_THEME_ENV_KEY = 'ADMIN_MANAGEMENT_THEME';
const ADMIN_THEME_MODE_ENV_KEY = 'ADMIN_MANAGEMENT_THEME_MODE';
const DEFAULT_ADMIN_THEME: AdminThemeKey = 'github';
const DEFAULT_ADMIN_THEME_MODE: AdminThemeMode = 'system';

const ADMIN_THEME_OPTIONS: AdminThemeOption[] = [
  {
    key: 'github',
    label: 'GitHub',
    description: '清爽中性的工程风，表格、索引和日志都很稳。',
    lightSwatches: ['#f6f8fa', '#24292f', '#0969da'],
    darkSwatches: ['#0d1117', '#e6edf3', '#2f81f7'],
  },
  {
    key: 'nord',
    label: 'Nord',
    description: '冷静蓝灰，适合长时间值守和低刺激阅读。',
    lightSwatches: ['#eceff4', '#2e3440', '#5e81ac'],
    darkSwatches: ['#2e3440', '#e5e9f0', '#88c0d0'],
  },
  {
    key: 'rose-pine',
    label: 'Rose Pine',
    description: '柔和暖调，减轻后台界面的冷硬感。',
    lightSwatches: ['#faf4ed', '#575279', '#b4637a'],
    darkSwatches: ['#191724', '#e0def4', '#c4a7e7'],
  },
  {
    key: 'one-dark-light',
    label: 'One Dark Light',
    description: 'Atom One 风格的明暗双态，适合代码、日志和运维表格。',
    lightSwatches: ['#fafafa', '#383a42', '#4078f2'],
    darkSwatches: ['#282c34', '#abb2bf', '#61afef'],
  },
];

const ADMIN_THEME_MODE_OPTIONS: AdminThemeModeOption[] = [
  { key: 'light', label: '亮色', description: '始终使用亮色外观。' },
  { key: 'dark', label: '暗色', description: '始终使用暗色外观。' },
  { key: 'system', label: '跟随系统', description: '自动跟随设备当前的明暗模式。' },
];

const ADMIN_THEME_KEYS = new Set(ADMIN_THEME_OPTIONS.map((item) => item.key));
const ADMIN_THEME_MODE_KEYS = new Set(ADMIN_THEME_MODE_OPTIONS.map((item) => item.key));

function normalizeThemeKey(value: unknown): AdminThemeKey {
  const key = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return ADMIN_THEME_KEYS.has(key) ? key : DEFAULT_ADMIN_THEME;
}

function normalizeThemeMode(value: unknown): AdminThemeMode {
  const mode = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return ADMIN_THEME_MODE_KEYS.has(mode as AdminThemeMode) ? (mode as AdminThemeMode) : DEFAULT_ADMIN_THEME_MODE;
}

function inferLegacyMode(rawKey: string): AdminThemeMode {
  if (!rawKey) return DEFAULT_ADMIN_THEME_MODE;
  if (rawKey.includes('light') || rawKey.includes('dawn') || rawKey.includes('day') || rawKey.includes('frost')) return 'light';
  if (
    rawKey.includes('dark') ||
    rawKey.includes('night') ||
    rawKey.includes('moon') ||
    rawKey.includes('main') ||
    rawKey.includes('dimmed') ||
    rawKey.includes('storm') ||
    rawKey.includes('hard') ||
    rawKey.includes('mocha') ||
    rawKey.includes('macchiato') ||
    rawKey.includes('polar')
  ) {
    return 'dark';
  }
  return DEFAULT_ADMIN_THEME_MODE;
}

function resolveLegacyThemeKey(value: unknown): { theme: AdminThemeKey; mode: AdminThemeMode } {
  const key = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (ADMIN_THEME_KEYS.has(key)) {
    return { theme: key, mode: DEFAULT_ADMIN_THEME_MODE };
  }
  if (key === 'github' || key.startsWith('github-')) {
    return {
      theme: 'github',
      mode: key === 'github' || key.includes('light') ? 'light' : 'dark',
    };
  }
  if (key === 'nord' || key.startsWith('nord-')) {
    return {
      theme: 'nord',
      mode: key.includes('frost') ? 'light' : 'dark',
    };
  }
  if (key === 'rosepine' || key === 'rose-pine' || key.startsWith('rose-pine-')) {
    return {
      theme: 'rose-pine',
      mode: key.includes('dawn') ? 'light' : 'dark',
    };
  }
  if (
    key === 'one'
    || key === 'one-dark'
    || key === 'one-light'
    || key === 'one-dark-light'
    || key.startsWith('one-dark-light-')
  ) {
    return {
      theme: 'one-dark-light',
      mode: key === 'one-light' || key.includes('light') ? 'light' : key.includes('dark') ? 'dark' : DEFAULT_ADMIN_THEME_MODE,
    };
  }
  return {
    theme: DEFAULT_ADMIN_THEME,
    mode: inferLegacyMode(key),
  };
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

  let output = raw;
  if (output && !output.endsWith('\n') && !output.endsWith('\r\n')) {
    output += newline;
  }
  if (!output.includes('# Admin Management UI')) {
    if (output) output += newline;
    output += `# Admin Management UI${newline}`;
  }
  output += `${key}=${value}${newline}`;
  return output;
}

export class AdminThemeService {
  getSettings(): AdminThemeSettings {
    const legacy = resolveLegacyThemeKey(process.env[ADMIN_THEME_ENV_KEY]);
    return {
      currentTheme: normalizeThemeKey(legacy.theme),
      currentMode: normalizeThemeMode(process.env[ADMIN_THEME_MODE_ENV_KEY] || legacy.mode),
      envKey: ADMIN_THEME_ENV_KEY,
      envModeKey: ADMIN_THEME_MODE_ENV_KEY,
      envPath: resolveAdminEnvWritePath(),
      themes: ADMIN_THEME_OPTIONS,
      modes: ADMIN_THEME_MODE_OPTIONS,
    };
  }

  async updateTheme(themeKey: string, mode: string): Promise<AdminThemeSettings> {
    const normalizedTheme = normalizeThemeKey(themeKey);
    const normalizedMode = normalizeThemeMode(mode);
    const envPath = resolveAdminEnvWritePath();

    await fs.mkdir(path.dirname(envPath), { recursive: true });
    const raw = await fs.readFile(envPath, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return '';
      throw error;
    });

    const nextRaw = replaceEnvValue(replaceEnvValue(raw, ADMIN_THEME_ENV_KEY, normalizedTheme), ADMIN_THEME_MODE_ENV_KEY, normalizedMode);
    await fs.writeFile(envPath, nextRaw, 'utf8');
    process.env[ADMIN_THEME_ENV_KEY] = normalizedTheme;
    process.env[ADMIN_THEME_MODE_ENV_KEY] = normalizedMode;
    return this.getSettings();
  }
}
