export const UI_LANGUAGES = ['en', 'zh', 'zh-TW', 'ja', 'fr', 'it', 'de', 'ko'] as const

export type UiLanguage = (typeof UI_LANGUAGES)[number]

export function isUiLanguage(value: unknown): value is UiLanguage {
  return typeof value === 'string' && UI_LANGUAGES.includes(value as UiLanguage)
}
