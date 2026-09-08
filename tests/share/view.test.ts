import { describe, expect, it } from 'vitest'
import {
  buildCardQrTarget,
  buildShareDescription,
  buildShareOgImageUrl,
  buildShareRedirectTarget,
  buildShareTitle,
} from '@/lib/share/view'

describe('buildShareTitle', () => {
  it('三语标题', () => {
    expect(buildShareTitle({ locale: 'zh', pointName: '须贺神社', bangumiTitle: '你的名字。' }))
      .toBe('须贺神社｜《你的名字。》圣地巡礼 | SeichiGo')
    expect(buildShareTitle({ locale: 'ja', pointName: '須賀神社', bangumiTitle: '君の名は。' }))
      .toBe('須賀神社｜『君の名は。』聖地巡礼 | SeichiGo')
    expect(buildShareTitle({ locale: 'en', pointName: 'Suga Shrine', bangumiTitle: 'Your Name' }))
      .toBe('Suga Shrine | Your Name anime pilgrimage | SeichiGo')
  })

  it('地名缺失时退回作品名', () => {
    expect(buildShareTitle({ locale: 'zh', pointName: '', bangumiTitle: '你的名字。' }))
      .toBe('《你的名字。》圣地巡礼 | SeichiGo')
  })
})

describe('buildShareDescription', () => {
  it('城市与集数都有时都写进去', () => {
    expect(buildShareDescription({ locale: 'zh', bangumiTitle: '你的名字。', city: '东京', ep: '1' }))
      .toBe('《你的名字。》在东京的取景地（第 1 集）。打开 SeichiGo 地图查看点位、周边点与路线。')
    expect(buildShareDescription({ locale: 'ja', bangumiTitle: '君の名は。', city: '東京', ep: '1' }))
      .toBe('『君の名は。』東京のロケ地（第1話）。SeichiGo のマップでスポットと周辺ルートを確認できます。')
    expect(buildShareDescription({ locale: 'en', bangumiTitle: 'Your Name', city: 'Tokyo', ep: '1' }))
      .toBe('A Your Name filming location in Tokyo (episode 1). Open the SeichiGo map for this spot and nearby routes.')
  })

  it('城市与集数缺失时不留空括号', () => {
    expect(buildShareDescription({ locale: 'zh', bangumiTitle: '你的名字。', city: null, ep: null }))
      .toBe('《你的名字。》的取景地。打开 SeichiGo 地图查看点位、周边点与路线。')
  })
})

describe('buildShareRedirectTarget', () => {
  it('zh 无前缀，参数顺序固定', () => {
    expect(
      buildShareRedirectTarget({ locale: 'zh', bangumiId: 101, pointId: '101:station', channel: 'x' }),
    ).toBe('/map?b=101&p=101%3Astation&utm_source=share&utm_medium=twitter&utm_campaign=point_card')
  })

  it('ja/en 带语言前缀', () => {
    expect(
      buildShareRedirectTarget({ locale: 'ja', bangumiId: 101, pointId: 'p1', channel: 'ln' }),
    ).toBe('/ja/map?b=101&p=p1&utm_source=share&utm_medium=line&utm_campaign=point_card')
    expect(
      buildShareRedirectTarget({ locale: 'en', bangumiId: 101, pointId: 'p1', channel: 'rd' }),
    ).toBe('/en/map?b=101&p=p1&utm_source=share&utm_medium=reddit&utm_campaign=point_card')
  })

  it('渠道缺失或非法时 utm_medium 记 unknown', () => {
    expect(
      buildShareRedirectTarget({ locale: 'zh', bangumiId: 101, pointId: 'p1', channel: null }),
    ).toBe('/map?b=101&p=p1&utm_source=share&utm_medium=unknown&utm_campaign=point_card')
  })
})

describe('buildCardQrTarget', () => {
  const base = { origin: 'https://seichigo.com', bangumiId: 101, pointId: '101:suga' }

  it('zh 无语言前缀，utm_medium 固定 image', () => {
    expect(buildCardQrTarget({ ...base, locale: 'zh' })).toBe(
      'https://seichigo.com/map?b=101&p=101%3Asuga&utm_source=share&utm_medium=image&utm_campaign=point_card',
    )
  })

  it('en / ja 带语言前缀', () => {
    expect(buildCardQrTarget({ ...base, locale: 'en' })).toContain('https://seichigo.com/en/map?')
    expect(buildCardQrTarget({ ...base, locale: 'ja' })).toContain('https://seichigo.com/ja/map?')
  })

  it('不含短链路径：卡片可长期缓存的前提', () => {
    expect(buildCardQrTarget({ ...base, locale: 'zh' })).not.toContain('/s/')
  })
})

describe('buildShareOgImageUrl', () => {
  const base = {
    origin: 'https://seichigo.com',
    code: 'AbC12xYz',
    pointId: '101:suga',
    locale: 'zh' as const,
  }

  it('有 imageKey 时维持现状指向 /api/share/img/<code>，并带指纹', () => {
    expect(
      buildShareOgImageUrl({ ...base, imageKey: 'share/AbC12xYz-deadbeef.webp', fingerprint: 'deadbeef' }),
    ).toBe('https://seichigo.com/api/share/img/AbC12xYz?v=deadbeef')
  })

  it('旧格式（无指纹）不带 ?v=', () => {
    expect(buildShareOgImageUrl({ ...base, imageKey: 'share/AbC12xYz.jpg', fingerprint: null })).toBe(
      'https://seichigo.com/api/share/img/AbC12xYz',
    )
  })

  it('没有 imageKey 时指向卡片路由的横版', () => {
    expect(buildShareOgImageUrl({ ...base, imageKey: null, fingerprint: null })).toBe(
      'https://seichigo.com/api/share/card/101%3Asuga?locale=zh&layout=landscape',
    )
  })

  it('匿名链的 locale 跟着短链走', () => {
    expect(
      buildShareOgImageUrl({ ...base, locale: 'ja', imageKey: null, fingerprint: null }),
    ).toContain('locale=ja')
  })
})
