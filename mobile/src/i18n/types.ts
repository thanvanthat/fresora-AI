import type en from './locales/en';

/** The English dictionary is the schema; every other locale must match its shape. */
export type Translations = typeof en;

/** Dot-path into the dictionary, e.g. 'home.greetingMorning'. */
export type TranslationKey = DeepKeys<Translations>;

type DeepKeys<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends string
    ? `${Prefix}${K}`
    : DeepKeys<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

export interface LanguageMeta {
  code: string;
  /** Name in the language itself -- never translated. */
  nativeName: string;
  englishName: string;
}

export const LANGUAGES: LanguageMeta[] = [
  { code: 'en', nativeName: 'English', englishName: 'English' },
  { code: 'ta', nativeName: 'தமிழ்', englishName: 'Tamil' },
  { code: 'hi', nativeName: 'हिन्दी', englishName: 'Hindi' },
  { code: 'ml', nativeName: 'മലയാളം', englishName: 'Malayalam' },
  { code: 'te', nativeName: 'తెలుగు', englishName: 'Telugu' },
  { code: 'kn', nativeName: 'ಕನ್ನಡ', englishName: 'Kannada' },
];

export const DEFAULT_LANGUAGE = 'en';
