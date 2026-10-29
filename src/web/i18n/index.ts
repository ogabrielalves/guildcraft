import en from './locales/en.json';
import ptBR from './locales/pt-BR.json';

export const LOCALES = ['en', 'pt-BR'] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';
export const LOCALE_STORAGE_KEY = 'guildcraft.locale';
export const LOCALE_NAMES: Record<Locale, string> = {
  en: 'English',
  'pt-BR': 'Português (Brasil)',
};

type Leaves<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${Prefix}${K}` : Leaves<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

export type TranslationKey = Leaves<typeof en>;
export type TranslationParams = Record<string, string | number>;
export type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>;
export type LocaleListener = (locale: Locale) => void;

export interface I18nEnvironment {
  storage: PreferenceStorage | null;
  languages: readonly string[];
}

export const DICTIONARIES: Record<Locale, Map<string, string>> = {
  en: flatten(en),
  'pt-BR': flatten(ptBR),
};

let currentLocale: Locale = DEFAULT_LOCALE;
let preferenceStorage: PreferenceStorage | null = null;
const listeners = new Set<LocaleListener>();

export function isLocale(value: unknown): value is Locale {
  return LOCALES.some((locale) => locale === value);
}

export function flatten(tree: object, prefix = ''): Map<string, string> {
  const entries = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = `${prefix}${key}`;
    if (typeof value === 'string') entries.set(path, value);
    else if (typeof value === 'object' && value !== null) {
      for (const entry of flatten(value as object, `${path}.`)) entries.set(...entry);
    }
  }
  return entries;
}

export function detectLocale(languages: readonly string[]): Locale {
  for (const language of languages) {
    const exact = LOCALES.find((locale) => locale.toLowerCase() === language.toLowerCase());
    if (exact) return exact;
    const base = language.split('-')[0]?.toLowerCase();
    const partial = LOCALES.find((locale) => locale.split('-')[0]?.toLowerCase() === base);
    if (partial) return partial;
  }
  return DEFAULT_LOCALE;
}

export function interpolate(template: string, params: TranslationParams = {}): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : match,
  );
}

export function translate(
  locale: Locale,
  key: TranslationKey | (string & {}),
  params?: TranslationParams,
): string {
  const template = DICTIONARIES[locale].get(key) ?? DICTIONARIES[DEFAULT_LOCALE].get(key) ?? key;
  return interpolate(template, params);
}

export function t(key: TranslationKey | (string & {}), params?: TranslationParams): string {
  return translate(currentLocale, key, params);
}

export function getLocale(): Locale {
  return currentLocale;
}

export function initI18n(environment: I18nEnvironment = browserEnvironment()): Locale {
  preferenceStorage = environment.storage;
  const saved = readPreference(environment.storage);
  currentLocale = saved ?? detectLocale(environment.languages);
  return currentLocale;
}

export function setLocale(locale: Locale): void {
  writePreference(preferenceStorage, locale);
  if (locale === currentLocale) return;
  currentLocale = locale;
  for (const listener of listeners) listener(locale);
}

export function onLocaleChange(listener: LocaleListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function readPreference(storage: PreferenceStorage | null): Locale | null {
  try {
    const value = storage?.getItem(LOCALE_STORAGE_KEY);
    return isLocale(value) ? value : null;
  } catch {
    return null;
  }
}

function writePreference(storage: PreferenceStorage | null, locale: Locale): void {
  try {
    storage?.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    return;
  }
}

function browserEnvironment(): I18nEnvironment {
  return { storage: browserStorage(), languages: browserLanguages() };
}

function browserStorage(): PreferenceStorage | null {
  try {
    const { localStorage } = globalThis as Partial<typeof globalThis>;
    return localStorage ?? null;
  } catch {
    return null;
  }
}

function browserLanguages(): readonly string[] {
  const nav = globalThis.navigator as Navigator | undefined;
  if (!nav) return [];
  if (nav.languages.length > 0) return nav.languages;
  return nav.language ? [nav.language] : [];
}
