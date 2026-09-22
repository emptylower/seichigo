import { describe, expect, it } from 'vitest'
import { readHomeHeroDemoFile, readHomeShowcaseFile } from '@/lib/home/generatedHomeFiles'
import { pickHeroDemo } from '@/lib/home/heroDemo'
import { localizeHomeShowcase, localizeShowcaseText } from '@/lib/home/showcaseLocale'
import { showcaseLodging, showcaseWorks } from '@/components/home/homeShowcase'

const source = readHomeShowcaseFile()
const eastAsianScript = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u

describe('home showcase translations against the published snapshot', () => {
  it.each(['en', 'ja'] as const)('covers all days and rendered copy in %s', (locale) => {
    const localized = localizeHomeShowcase(source, locale)
    expect(localized.title).not.toBe(source.title)
    expect(localized.summary).not.toBe(source.summary)
    expect(localized.days).toHaveLength(8)
    for (const [index, day] of localized.days.entries()) {
      const original = source.days[index]!
      if (original.summary) expect(day.summary).not.toBe(original.summary)
      for (const [itemIndex, item] of day.items.entries()) {
        const originalItem = original.items[itemIndex]!
        if (item.type === 'transit') continue
        expect(item.title, `Day ${day.dayIndex}: ${originalItem.title}`).not.toBe(originalItem.title)
        if (originalItem.note) expect(item.note).not.toBe(originalItem.note)
        if (locale === 'en') {
          expect(item.title).not.toMatch(eastAsianScript)
          expect(item.note ?? '').not.toMatch(eastAsianScript)
        }
      }
      if (locale === 'en') expect(day.summary ?? '').not.toMatch(eastAsianScript)
    }
    expect(showcaseLodging(localized.days)).toBe(locale === 'en'
      ? 'Shinjuku Washington Hotel (base for 7 nights)'
      : '新宿ワシントンホテル（7連泊の拠点）')
    expect(showcaseWorks(localized.days)).toEqual(locale === 'en'
      ? ['The Garden of Words', 'Your Name', 'Weathering with You', 'Bocchi the Rock!']
      : ['言の葉の庭', '君の名は。', '天気の子', 'ぼっち・ざ・ろっく！'])
  })

  it.each(['en', 'ja'] as const)('keeps coordinates, schedules, transport, media and credits unchanged in %s', (locale) => {
    const before = structuredClone(source)
    const localized = localizeHomeShowcase(source, locale)
    for (const [index, day] of localized.days.entries()) {
      const original = source.days[index]!
      expect({ ...day, summary: original.summary, items: original.items }).toEqual(original)
      for (const [itemIndex, item] of day.items.entries()) {
        const originalItem = original.items[itemIndex]!
        expect({ ...item, title: originalItem.title, note: originalItem.note }).toEqual(originalItem)
      }
    }
    expect(source).toEqual(before)
    expect(localizeHomeShowcase(source, 'zh')).toBe(source)
  })

  it('does not attach old copy to a regenerated item with the same ID', () => {
    const changed = structuredClone(source)
    changed.days[0]!.items[0]!.title = 'A different itinerary stop'
    changed.days[0]!.items[0]!.note = 'New source text'
    const localized = localizeHomeShowcase(changed, 'en')
    expect(localized.days[0]!.items[0]!.title).toBe('A different itinerary stop')
    expect(localized.days[0]!.items[0]!.note).toBe('New source text')
    expect(localizeShowcaseText('toString', 'en')).toBe('toString')
  })

  it('regenerates all three published hero titles in English without changing route data', async () => {
    const published = readHomeHeroDemoFile()
    const regenerated = await pickHeroDemo(source.days, async () => {
      throw new Error('Published demo images should already be static')
    }, { anime: '你的名字' })
    expect(regenerated?.items.map((item) => item.titles.en)).toEqual([
      'Suga Shrine Steps', 'Shinanomachi Footbridge', 'Yotsuya Mitsuke Bridge',
    ])
    expect(regenerated?.items).toEqual(published.day.items)
    expect(regenerated?.transit).toEqual(published.day.transit)
  })
})
