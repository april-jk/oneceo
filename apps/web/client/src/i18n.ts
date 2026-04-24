import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

// 导入翻译文件
import en from './locales/en.json' with { type: 'json' };
import zh from './locales/zh.json' with { type: 'json' };

export const SUPPORTED_LANGUAGES = ['zh', 'en'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export function normalizeLanguage(value: string | null | undefined): SupportedLanguage {
  const normalized = (value || '').trim().toLowerCase();
  if (normalized.startsWith('zh')) {
    return 'zh';
  }
  return 'en';
}

// 配置 i18n
i18n
  .use(LanguageDetector) // 自动检测用户语言
  .use(initReactI18next) // 将 i18n 实例传递给 react-i18next
  .init({
    resources: {
      en: {
        translation: en,
      },
      zh: {
        translation: zh,
      },
    },
    fallbackLng: 'zh', // 默认语言
    supportedLngs: SUPPORTED_LANGUAGES,
    nonExplicitSupportedLngs: true,
    load: 'languageOnly',
    debug: false,
    interpolation: {
      escapeValue: false, // React 已经处理了 XSS
    },
    detection: {
      // 语言检测顺序
      order: ['localStorage', 'navigator'],
      // 缓存用户语言选择
      caches: ['localStorage'],
      lookupLocalStorage: 'i18nextLng',
    },
  });

export default i18n;
