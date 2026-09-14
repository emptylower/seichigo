import { describe, expect, it } from 'vitest'
import { buildPlanStartMetadata } from '@/lib/seo/planStart'

const ORIGIN = 'https://example.com'

describe('buildPlanStartMetadata（三语起始页 metadata）', () => {
  it('zh：title/description 取中文文案，canonical/OG URL 为中文干净路径', () => {
    process.env.SITE_URL = ORIGIN
    const meta = buildPlanStartMetadata('zh')

    expect(meta.title).toBe('AI 规划｜动漫圣地巡礼行程助手')
    expect(meta.description).toBe(
      '输入作品、目的地和天数，规划每天的巡礼路线与交通建议。登录后可生成并继续调整行程。',
    )
    expect(meta.alternates?.canonical).toBe('/plan/start')
    expect(meta.openGraph?.url).toBe(`${ORIGIN}/plan/start`)
    expect(meta.openGraph?.title).toBe('AI 规划｜动漫圣地巡礼行程助手')
    expect(meta.twitter?.title).toBe('AI 规划｜动漫圣地巡礼行程助手')
  })

  it('en：英文文案与 /en/plan/start 干净路径', () => {
    process.env.SITE_URL = ORIGIN
    const meta = buildPlanStartMetadata('en')

    expect(meta.title).toBe('AI Planner | Anime Pilgrimage Itineraries')
    expect(meta.description).toBe(
      'Enter your anime, destinations and travel dates to plan daily pilgrimage routes and transport suggestions. Sign in to generate and refine your itinerary.',
    )
    expect(meta.alternates?.canonical).toBe('/en/plan/start')
    expect(meta.openGraph?.url).toBe(`${ORIGIN}/en/plan/start`)
  })

  it('ja：日文文案与 /ja/plan/start 干净路径', () => {
    process.env.SITE_URL = ORIGIN
    const meta = buildPlanStartMetadata('ja')

    expect(meta.title).toBe('AIプランナー｜アニメ聖地巡礼の旅行プラン')
    expect(meta.description).toBe(
      '作品・行き先・日数を入力して、日ごとの巡礼ルートと交通の提案をまとめます。ログイン後にプランを作成・調整できます。',
    )
    expect(meta.alternates?.canonical).toBe('/ja/plan/start')
    expect(meta.openGraph?.url).toBe(`${ORIGIN}/ja/plan/start`)
  })

  it('hreflang 三语互返且 x-default 指中文；canonical 不含 draft/locale', () => {
    process.env.SITE_URL = ORIGIN
    for (const locale of ['zh', 'en', 'ja'] as const) {
      const meta = buildPlanStartMetadata(locale)
      expect(meta.alternates?.languages).toEqual({
        zh: `${ORIGIN}/plan/start`,
        en: `${ORIGIN}/en/plan/start`,
        ja: `${ORIGIN}/ja/plan/start`,
        'x-default': `${ORIGIN}/plan/start`,
      })
      expect(String(meta.alternates?.canonical)).not.toContain('?')
    }
  })

  it('不写 robots 字段（继承根 layout 的公开配置）', () => {
    for (const locale of ['zh', 'en', 'ja'] as const) {
      expect(buildPlanStartMetadata(locale).robots).toBeUndefined()
    }
  })
})
