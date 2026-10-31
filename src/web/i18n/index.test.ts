import { afterEach, describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '../../shared/errors.js';
import type { PreferenceStorage } from './index.js';
import {
  DEFAULT_LOCALE,
  DICTIONARIES,
  LOCALES,
  LOCALE_NAMES,
  LOCALE_STORAGE_KEY,
  detectLocale,
  flatten,
  getLocale,
  initI18n,
  interpolate,
  isLocale,
  onLocaleChange,
  setLocale,
  t,
  translate,
} from './index.js';

function memoryStorage(initial: Record<string, string> = {}): PreferenceStorage {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
  };
}

function brokenStorage(): PreferenceStorage {
  return {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('blocked');
    },
  };
}

function placeholders(text: string): string[] {
  return [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1] ?? '').sort();
}

afterEach(() => {
  initI18n({ storage: null, languages: [] });
  vi.unstubAllGlobals();
});

describe('locales', () => {
  const reference = DICTIONARIES[DEFAULT_LOCALE];

  it.each(LOCALES)('%s has exactly the same keys as en', (locale) => {
    expect([...DICTIONARIES[locale].keys()].sort()).toEqual([...reference.keys()].sort());
  });

  it.each(LOCALES)('%s uses the same placeholders as en', (locale) => {
    for (const [key, text] of reference) {
      expect(placeholders(DICTIONARIES[locale].get(key) ?? ''), key).toEqual(placeholders(text));
    }
  });

  it.each(LOCALES)('%s has no empty strings', (locale) => {
    for (const [key, text] of DICTIONARIES[locale]) expect(text.trim(), key).not.toBe('');
  });

  it.each(ERROR_CODES)('translates error code %s', (code) => {
    expect(reference.has(`errors.${code}`)).toBe(true);
  });

  it.each(LOCALES)('names %s', (locale) => {
    expect(LOCALE_NAMES[locale]).not.toBe('');
  });
});

describe('flatten', () => {
  it('joins nested keys with dots and skips non-strings', () => {
    const result = flatten({ a: 'x', b: { c: 'y', d: { e: 'z' } }, f: 1, g: null });
    expect([...result]).toEqual([
      ['a', 'x'],
      ['b.c', 'y'],
      ['b.d.e', 'z'],
    ]);
  });
});

describe('isLocale', () => {
  it.each(LOCALES)('accepts %s', (locale) => {
    expect(isLocale(locale)).toBe(true);
  });

  it.each(['pt', 'fr', '', null])('rejects %s', (value) => {
    expect(isLocale(value)).toBe(false);
  });
});

describe('detectLocale', () => {
  it.each([
    [['pt-BR'], 'pt-BR'],
    [['pt-br'], 'pt-BR'],
    [['pt-PT'], 'pt-BR'],
    [['pt'], 'pt-BR'],
    [['en-US'], 'en'],
    [['fr-FR', 'pt-BR'], 'pt-BR'],
    [['fr-FR', 'de'], 'en'],
    [[], 'en'],
  ])('maps %j to %s', (languages, expected) => {
    expect(detectLocale(languages)).toBe(expected);
  });
});

describe('interpolate', () => {
  it('replaces named params', () => {
    expect(interpolate('{from} → {to}', { from: 'Ana', to: 'Bia' })).toBe('Ana → Bia');
  });

  it('formats numbers', () => {
    expect(interpolate('{count} queued', { count: 3 })).toBe('3 queued');
  });

  it('keeps unknown placeholders', () => {
    expect(interpolate('hi {name}', {})).toBe('hi {name}');
  });

  it('ignores inherited properties', () => {
    expect(interpolate('{toString}')).toBe('{toString}');
  });
});

describe('translate', () => {
  it('uses the requested locale', () => {
    expect(translate('pt-BR', 'panel.restart')).toBe('Reiniciar');
    expect(translate('en', 'panel.restart')).toBe('Restart');
  });

  it('interpolates params', () => {
    expect(translate('en', 'errors.AGENT_NAME_TAKEN', { name: 'Brom' })).toBe(
      'There is already an adventurer named Brom',
    );
  });

  it('falls back to english when a locale misses a key', () => {
    DICTIONARIES['pt-BR'].delete('panel.copy');
    try {
      expect(translate('pt-BR', 'panel.copy')).toBe('Copy');
    } finally {
      DICTIONARIES['pt-BR'].set('panel.copy', 'Copiar');
    }
  });

  it('falls back to the key itself when nobody has it', () => {
    expect(translate('pt-BR', 'nope.missing')).toBe('nope.missing');
  });
});

describe('runtime locale', () => {
  it('prefers the saved locale', () => {
    const storage = memoryStorage({ [LOCALE_STORAGE_KEY]: 'pt-BR' });
    expect(initI18n({ storage, languages: ['en-US'] })).toBe('pt-BR');
    expect(t('panel.remove')).toBe('Apagar aventureiro');
  });

  it('ignores an invalid saved locale', () => {
    const storage = memoryStorage({ [LOCALE_STORAGE_KEY]: 'xx' });
    expect(initI18n({ storage, languages: ['pt-BR'] })).toBe('pt-BR');
  });

  it('detects from languages without storage', () => {
    expect(initI18n({ storage: null, languages: ['en-GB'] })).toBe('en');
  });

  it('survives storage that throws', () => {
    initI18n({ storage: brokenStorage(), languages: ['pt-BR'] });
    expect(getLocale()).toBe('pt-BR');
    expect(() => {
      setLocale('en');
    }).not.toThrow();
    expect(getLocale()).toBe('en');
  });

  it('saves the choice and notifies listeners once per change', () => {
    const storage = memoryStorage();
    initI18n({ storage, languages: ['en'] });
    const listener = vi.fn();
    const unsubscribe = onLocaleChange(listener);

    setLocale('pt-BR');
    setLocale('pt-BR');
    unsubscribe();
    setLocale('en');

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith('pt-BR');
    expect(storage.getItem(LOCALE_STORAGE_KEY)).toBe('en');
  });

  it('reads the browser environment by default', () => {
    vi.stubGlobal('localStorage', memoryStorage());
    vi.stubGlobal('navigator', { languages: ['pt-BR'], language: 'pt-BR' });
    expect(initI18n()).toBe('pt-BR');
  });

  it('uses navigator.language when languages is empty', () => {
    vi.stubGlobal('navigator', { languages: [], language: 'pt-PT' });
    expect(initI18n()).toBe('pt-BR');
  });

  it('defaults to english without a browser', () => {
    vi.stubGlobal('navigator', undefined);
    vi.stubGlobal('localStorage', undefined);
    expect(initI18n()).toBe('en');
  });

  it('handles a localStorage getter that throws', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get: () => {
        throw new Error('denied');
      },
    });
    try {
      vi.stubGlobal('navigator', { languages: ['en'], language: 'en' });
      expect(initI18n()).toBe('en');
    } finally {
      Reflect.deleteProperty(globalThis, 'localStorage');
    }
  });
});
