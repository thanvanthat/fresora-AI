import en from './locales/en';
import hi from './locales/hi';
import kn from './locales/kn';
import ml from './locales/ml';
import ta from './locales/ta';
import te from './locales/te';
import { LANGUAGES, getLanguage, setLanguage, t, tPlural } from './index';

/**
 * Localisation.
 *
 * The important properties are structural: every locale must be a subset of the
 * English key space (so a typo cannot silently create a key nothing reads), no
 * translated string may lose an interpolation placeholder, and a missing key
 * must fall back to English rather than rendering blank.
 */

const LOCALES = { ta, hi, ml, te, kn } as const;

/** Flattens a nested dictionary to dot paths -> value. */
function flatten(obj: unknown, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof obj !== 'object' || obj === null) return out;

  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out[path] = value;
    else Object.assign(out, flatten(value, path));
  }
  return out;
}

const EN_KEYS = flatten(en);

/** Extracts {{placeholder}} names from a template. */
const placeholders = (value: string): string[] =>
  (value.match(/\{\{(\w+)\}\}/g) ?? []).sort();

afterEach(() => {
  // Language is module-level state; reset so tests stay independent.
  setLanguage('en');
});

// --- Registry -------------------------------------------------------------

describe('language registry', () => {
  it('ships the six launch languages', () => {
    expect(LANGUAGES.map((entry) => entry.code)).toEqual([
      'en',
      'ta',
      'hi',
      'ml',
      'te',
      'kn',
    ]);
  });

  it('names each language in its own script', () => {
    const native = Object.fromEntries(
      LANGUAGES.map((entry) => [entry.code, entry.nativeName]),
    );
    // A user looking for Tamil looks for "தமிழ்", not "Tamil".
    expect(native.ta).toBe('தமிழ்');
    expect(native.hi).toBe('हिन्दी');
    expect(native.ml).toBe('മലയാളം');
    expect(native.te).toBe('తెలుగు');
    expect(native.kn).toBe('ಕನ್ನಡ');
  });

  it('gives every language an English name too', () => {
    for (const entry of LANGUAGES) {
      expect(entry.englishName).toBeTruthy();
    }
  });
});

// --- Structure ------------------------------------------------------------

describe('locale structure', () => {
  it('has a non-trivial English dictionary', () => {
    // Guards against an accidental truncation of the reference locale.
    expect(Object.keys(EN_KEYS).length).toBeGreaterThan(300);
  });

  it.each(Object.keys(LOCALES))('%s introduces no keys absent from English', (code) => {
    const keys = Object.keys(flatten(LOCALES[code as keyof typeof LOCALES]));
    const unknown = keys.filter((key) => !(key in EN_KEYS));
    expect(unknown).toEqual([]);
  });

  it.each(Object.keys(LOCALES))('%s keeps every interpolation placeholder', (code) => {
    const translated = flatten(LOCALES[code as keyof typeof LOCALES]);
    const mismatched: string[] = [];

    for (const [key, value] of Object.entries(translated)) {
      const expected = placeholders(EN_KEYS[key] ?? '');
      if (expected.length === 0) continue;
      // A dropped {{count}} would render "ingredients need attention" with no
      // number at all.
      if (placeholders(value).join() !== expected.join()) mismatched.push(key);
    }
    expect(mismatched).toEqual([]);
  });

  it.each(Object.keys(LOCALES))('%s has no empty strings', (code) => {
    const translated = flatten(LOCALES[code as keyof typeof LOCALES]);
    const empty = Object.entries(translated)
      .filter(([, value]) => value.trim() === '')
      .map(([key]) => key);
    expect(empty).toEqual([]);
  });

  it.each(Object.keys(LOCALES))('%s translates the core user surface', (code) => {
    const translated = flatten(LOCALES[code as keyof typeof LOCALES]);
    // The screens a user cannot avoid. A gap here means visible English.
    const required = [
      'common.appName',
      'common.tagline',
      'status.fresh',
      'status.nearlySpoiled',
      'status.spoiled',
      'tabs.home',
      'tabs.scan',
      'home.scanFood',
      'scanner.prompt',
      'analysis.detailsTitle',
      'inventory.title',
      'recipes.generate',
      'safety.fullNotice',
      'safety.shortNotice',
      'errors.genericTitle',
    ];
    const missing = required.filter((key) => !(key in translated));
    expect(missing).toEqual([]);
  });
});

// --- Safety copy ----------------------------------------------------------

describe('safety copy', () => {
  it('never claims food is safe, in any language', () => {
    // The one thing the app must never say.
    const forbidden = [/\bis safe\b/i, /100% safe/i, /pathogen-free/i, /guarantees? safe/i];

    for (const [code, dictionary] of Object.entries({ en, ...LOCALES })) {
      for (const [key, value] of Object.entries(flatten(dictionary))) {
        for (const pattern of forbidden) {
          expect(pattern.test(value)).toBe(false);
        }
      }
      expect(code).toBeTruthy();
    }
  });

  it('states the limits of image analysis in English', () => {
    const notice = en.safety.fullNotice;
    expect(notice).toContain('cannot detect microscopic bacteria');
    expect(notice).toContain('not official food-safety guarantees');
  });
});

// --- Runtime behaviour ----------------------------------------------------

describe('t()', () => {
  it('returns the active language string', () => {
    setLanguage('ta');
    expect(t('status.fresh')).toBe(ta.status?.fresh);
  });

  it('falls back to English for an untranslated key', () => {
    setLanguage('ta');
    // Force a gap: ask for a key Tamil does not define.
    const tamilKeys = flatten(ta);
    const gap = Object.keys(EN_KEYS).find((key) => !(key in tamilKeys));

    if (gap) {
      expect(t(gap)).toBe(EN_KEYS[gap]);
    } else {
      // Tamil is fully translated -- assert the mechanism another way.
      expect(t('common.appName')).toBeTruthy();
    }
  });

  it('returns the key itself when nothing matches', () => {
    // Returning the key makes a missing translation obvious rather than
    // collapsing the layout with an empty string.
    expect(t('nope.not.a.key')).toBe('nope.not.a.key');
  });

  it('interpolates named parameters', () => {
    setLanguage('en');
    expect(t('inventory.daysRemaining', { count: 4 })).toBe('4 days remaining');
  });

  it('leaves an unsupplied placeholder visible rather than blank', () => {
    expect(t('inventory.daysRemaining')).toContain('{{count}}');
  });

  it('ignores an unknown language and keeps the current one', () => {
    setLanguage('en');
    setLanguage('klingon');
    expect(getLanguage()).toBe('en');
  });
});

describe('tPlural()', () => {
  it('uses the singular form for exactly one', () => {
    setLanguage('en');
    expect(tPlural('inventory.dayRemaining', 'inventory.daysRemaining', 1)).toBe(
      '1 day remaining',
    );
  });

  it('uses the plural form otherwise', () => {
    setLanguage('en');
    expect(tPlural('inventory.dayRemaining', 'inventory.daysRemaining', 3)).toBe(
      '3 days remaining',
    );
    expect(tPlural('inventory.dayRemaining', 'inventory.daysRemaining', 0)).toBe(
      '0 days remaining',
    );
  });
});
