export interface LocalizedText {
  zh?: string | null;
  en?: string | null;
}

export interface ScienceModule {
  id: string;
  title: LocalizedText;
  description: LocalizedText;
  icon: string;
  agentGroup: string;
  experts: string[];
  quickPrompt: LocalizedText;
  tags: string[];
  installed?: boolean;
  installedExperts?: string[];
  source?: string;
}

export type ScienceModuleLanguage = 'zh' | 'en';

/** Collapse any i18n language tag ("en-US", "zh-CN", ...) into a supported module language. */
export function resolveScienceLanguage(language?: string | null): ScienceModuleLanguage {
  return typeof language === 'string' && language.toLowerCase().startsWith('en') ? 'en' : 'zh';
}

/** Pick the requested language, falling back to the other locale before the caller fallback. */
export function pickLocalizedText(
  value: LocalizedText | string | null | undefined,
  language?: string | null,
  fallback = '',
): string {
  if (typeof value === 'string') return value.trim() || fallback;
  if (!value || typeof value !== 'object') return fallback;
  const primary = resolveScienceLanguage(language);
  const ordered = primary === 'en' ? [value.en, value.zh] : [value.zh, value.en];
  for (const candidate of ordered) {
    const text = typeof candidate === 'string' ? candidate.trim() : '';
    if (text) return text;
  }
  return fallback;
}

export function moduleExpertCount(module: Pick<ScienceModule, 'experts'> | null | undefined): number {
  return module && Array.isArray(module.experts) ? module.experts.length : 0;
}

export function moduleQuickPrompt(
  module: Pick<ScienceModule, 'quickPrompt'> | null | undefined,
  language?: string | null,
  fallback = '',
): string {
  return pickLocalizedText(module?.quickPrompt, language, fallback);
}

/** Turn an unknown request failure into the message shown in the error state. */
export function resolveScienceModuleError(error: unknown, fallback: string): string {
  if (typeof error === 'string') return error.trim() || fallback;
  if (error instanceof Error) return error.message.trim() || fallback;
  if (error && typeof error === 'object') {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message.trim();
  }
  return fallback;
}

function readText(value: unknown): LocalizedText {
  if (typeof value === 'string') return { zh: value, en: value };
  if (!value || typeof value !== 'object') return {};
  const record = value as Record<string, unknown>;
  return {
    zh: typeof record.zh === 'string' ? record.zh : '',
    en: typeof record.en === 'string' ? record.en : '',
  };
}

function readStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
    : [];
}

/** Normalize the science_modules.list payload and drop unusable module records. */
export function normalizeScienceModules(payload: unknown): ScienceModule[] {
  const rawModules = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object'
      ? (payload as { modules?: unknown }).modules
      : undefined;
  if (!Array.isArray(rawModules)) return [];
  return rawModules.flatMap((item): ScienceModule[] => {
    if (!item || typeof item !== 'object') return [];
    const record = item as Record<string, unknown>;
    const id = typeof record.id === 'string' ? record.id.trim() : '';
    if (!id) return [];
    return [{
      id,
      title: readText(record.title),
      description: readText(record.description),
      icon: typeof record.icon === 'string' ? record.icon : '',
      agentGroup: typeof record.agentGroup === 'string' ? record.agentGroup : '',
      experts: readStringList(record.experts),
      quickPrompt: readText(record.quickPrompt),
      tags: readStringList(record.tags),
      installed: record.installed === true,
      installedExperts: readStringList(record.installedExperts),
      source: typeof record.source === 'string' ? record.source : undefined,
    }];
  });
}
