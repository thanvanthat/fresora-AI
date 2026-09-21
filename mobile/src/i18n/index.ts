import { useSyncExternalStore } from 'react';
import { NativeModules, Platform } from 'react-native';

import en from './locales/en';
import hi from './locales/hi';
import kn from './locales/kn';
import ml from './locales/ml';
import ta from './locales/ta';
import te from './locales/te';
import { DEFAULT_LANGUAGE, LANGUAGES, type TranslationKey, type Translations } from './types';

export { LANGUAGES, DEFAULT_LANGUAGE } from './types';
export type { TranslationKey, LanguageMeta } from './types';

/**
 * A locale may translate any subset of the dictionary. Anything it omits falls
 * back to English, so a partially translated language still renders a complete
 * UI instead of blank strings.
 */
type DeepPartial<T> = { [K in keyof T]?: T[K] extends string ? string : DeepPartial<T[K]> };
export type LocaleDictionary = DeepPartial<Translations>;

const dictionaries: Record<string, LocaleDictionary> = { en, ta, hi, ml, te, kn };

let current = DEFAULT_LANGUAGE;
const listeners = new Set<() => void>();

const notify = () => listeners.forEach((l) => l());

/** Reads a dot path out of a nested dictionary. Returns undefined if absent. */
const lookup = (dict: LocaleDictionary | undefined, path: string): string | undefined => {
  if (!dict) return undefined;
  let node: unknown = dict;
  for (const segment of path.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[segment];
  }
  return typeof node === 'string' ? node : undefined;
};

/** Replaces {{name}} placeholders. Missing params are left visible, not blanked. */
const interpolate = (template: string, params?: Record<string, string | number>): string => {
  if (!params) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
    key in params ? String(params[key]) : match,
  );
};

/**
 * Translate a key in the active language.
 *
 * Resolution order: active locale -> English -> the key itself. Returning the
 * key (rather than an empty string) makes a missing translation obvious in
 * development instead of silently collapsing the layout.
 */
export function t(key: TranslationKey | string, params?: Record<string, string | number>): string {
  const template = lookup(dictionaries[current], key) ?? lookup(en, key) ?? key;
  return interpolate(template, params);
}

/**
 * Pluralisation. Fresora only ever needs one/other, so we take the two keys
 * explicitly rather than pulling in a full CLDR plural-rules dependency.
 */
export function tPlural(
  oneKey: TranslationKey | string,
  otherKey: TranslationKey | string,
  count: number,
  params?: Record<string, string | number>,
): string {
  return t(count === 1 ? oneKey : otherKey, { count, ...params });
}

export const getLanguage = (): string => current;

export function setLanguage(code: string): void {
  if (!dictionaries[code] || code === current) return;
  current = code;
  notify();
}

/** Best-effort device locale, mapped onto a language we actually ship. */
export function detectDeviceLanguage(): string {
  const raw =
    Platform.OS === 'ios'
      ? (NativeModules.SettingsManager?.settings?.AppleLocale as string | undefined) ??
        (NativeModules.SettingsManager?.settings?.AppleLanguages?.[0] as string | undefined)
      : (NativeModules.I18nManager?.localeIdentifier as string | undefined);

  const prefix = raw?.replace('_', '-').split('-')[0]?.toLowerCase();
  return prefix && dictionaries[prefix] ? prefix : DEFAULT_LANGUAGE;
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/**
 * Subscribing to the language through useSyncExternalStore means every screen
 * re-renders on a language change without a context provider wrapping the tree.
 */
export function useTranslation() {
  const language = useSyncExternalStore(subscribe, getLanguage, getLanguage);
  return { t, tPlural, language, setLanguage, languages: LANGUAGES };
}
