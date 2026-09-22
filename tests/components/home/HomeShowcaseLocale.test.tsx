import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import HomeHeroPhone from '@/components/home/HomeHeroPhone'
import HomeShowcasePlan from '@/components/home/HomeShowcasePlan'
import { readHomeHeroDemoFile, readHomeShowcaseFile } from '@/lib/home/generatedHomeFiles'
import { localizeHomeShowcase } from '@/lib/home/showcaseLocale'
import { clearMatchMediaStub, setPrefersReducedMotion } from './reducedMotion'

const source = readHomeShowcaseFile()
const FIRST_STOPS = {
  en: [
    'Arrive in Tokyo・Airport to Shinjuku Washington Hotel',
    'The Garden of Words・Shinjuku Gyoen, Shinjuku Gate',
    'Your Name・Omotesando',
    'Full day at Tokyo Disneyland',
    'Bocchi the Rock!・Katase-Enoshima Station',
    'Your Name・Footbridge in front of Tokyu Plaza Akasaka',
    'Weathering with You・Tabata Station south exit',
    'Morning: Check out and last-minute shopping',
  ],
  ja: [
    '東京到着・空港→新宿ワシントンホテル',
    '言の葉の庭・新宿御苑 新宿門',
    '君の名は。・表参道',
    '東京ディズニーランドで一日満喫',
    'ぼっち・ざ・ろっく！ ・ 片瀬江ノ島駅',
    '君の名は。・東急プラザ赤坂前歩道橋',
    '天気の子・田端駅南口',
    '午前：チェックアウト・最後の買い物',
  ],
}

describe('published homepage examples in English and Japanese', () => {
  beforeEach(() => setPrefersReducedMotion(true))
  afterEach(() => {
    cleanup()
    clearMatchMediaStub()
  })

  it.each(['en', 'ja'] as const)('keeps every selectable day localized in %s', (locale) => {
    const { container } = render(<HomeShowcasePlan locale={locale} showcase={localizeHomeShowcase(source, locale)} />)
    expect(screen.getAllByText(locale === 'en' ? '8 Days in Tokyo · Christmas 2026' : '2026年クリスマス・東京8日間')).toHaveLength(2)
    expect(screen.getByText(locale === 'en' ? 'Bocchi the Rock!' : 'ぼっち・ざ・ろっく！')).toBeInTheDocument()

    for (const [index, expectedStop] of FIRST_STOPS[locale].entries()) {
      fireEvent.click(screen.getByRole('button', { name: `Day ${index + 1}` }))
      expect(screen.getByText(expectedStop)).toBeInTheDocument()
      const copy = container.cloneNode(true) as HTMLElement
      // Photo credits are third-party names and must retain their original language.
      copy.querySelectorAll('span[title]').forEach((credit) => credit.remove())
      const renderedText = copy.textContent ?? ''
      if (locale === 'en') expect(renderedText).not.toMatch(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u)
      for (const day of source.days) {
        if (day.summary) expect(renderedText).not.toContain(day.summary)
        for (const item of day.items) {
          if (item.type === 'transit') continue
          expect(renderedText).not.toContain(item.title)
          if (item.note) expect(renderedText).not.toContain(item.note)
        }
      }
    }
  })

  it.each(['en', 'ja'] as const)('renders the real hero titles and transit durations in %s', (locale) => {
    const demo = readHomeHeroDemoFile()
    const { container } = render(<HomeHeroPhone locale={locale} demo={demo} />)
    expect([...container.querySelectorAll('[data-phone-title]')].map((node) => node.textContent)).toEqual(
      locale === 'en'
        ? ['Suga Shrine Steps', 'Shinanomachi Footbridge', 'Yotsuya Mitsuke Bridge']
        : ['須賀神社男坂上', '信濃町歩道橋', '四谷見附橋'],
    )
    expect([...container.querySelectorAll('[data-phone-transit]')].map((node) => node.textContent?.trim())).toEqual(
      locale === 'en' ? ['Walk 34 min', 'Walk 13 min'] : ['徒歩 34 分', '徒歩 13 分'],
    )
    expect(screen.getByTestId('hero-phone-summary')).toHaveTextContent(
      locale === 'en' ? 'Day 1 · 3 stops · about 47 min walking' : 'Day 1 · 3 か所 · 徒歩 約47分',
    )
    expect(container.textContent).not.toMatch(/步行|分钟|你的名字|须贺|信浓|见附/)
    expect(container.querySelector('[data-phone-item] img')).toHaveAttribute('src', demo.day.items[0]!.imageUrl)
    expect(container.textContent).toContain(demo.map!.attribution)
  })
})
