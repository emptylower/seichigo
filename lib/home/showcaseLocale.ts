import english from '@/content/generated/home-showcase.en.json'
import japanese from '@/content/generated/home-showcase.ja.json'
import type { SupportedLocale } from '@/lib/i18n/types'
import type { HomeShowcase } from './types'

const TRANSLATIONS: Record<'en' | 'ja', Readonly<Record<string, string>>> = {
  en: english,
  ja: japanese,
}

/** Exact source text avoids applying old translations to a regenerated plan's reused IDs. */
export function localizeShowcaseText(text: string, locale: SupportedLocale): string {
  if (locale === 'zh') return text
  const dictionary = TRANSLATIONS[locale]
  return Object.hasOwn(dictionary, text) ? dictionary[text]! : text
}

/** Translate only rendered copy, on the server; retain source data, media and attribution. */
export function localizeHomeShowcase(showcase: HomeShowcase, locale: SupportedLocale): HomeShowcase {
  if (locale === 'zh') return showcase
  return {
    ...showcase,
    title: localizeShowcaseText(showcase.title, locale),
    summary: localizeShowcaseText(showcase.summary, locale),
    days: showcase.days.map((day) => ({
      ...day,
      summary: day.summary === null ? null : localizeShowcaseText(day.summary, locale),
      items: day.items.map((item) => item.type === 'transit' ? item : {
        ...item,
        title: localizeShowcaseText(item.title, locale),
        note: item.note === null ? null : localizeShowcaseText(item.note, locale),
      }),
    })),
  }
}
