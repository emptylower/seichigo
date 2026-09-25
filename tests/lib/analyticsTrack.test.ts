import { afterEach, describe, expect, it, vi } from 'vitest'
import { GA_MEASUREMENT_ID, track } from '@/lib/analytics/track'

type FakeWindow = {
  location: { hostname: string; pathname: string }
  dataLayer?: unknown[]
  __seichigoGaConfigured?: boolean
  localStorage?: { getItem: (key: string) => string | null }
}

/** node 环境默认没有 window：按需伪造一个，只放 track 会读到的字段 */
function setWindow(hostname: string, pathname = '/'): FakeWindow {
  const fake: FakeWindow = {
    location: { hostname, pathname },
    // track 内部用 window.localStorage.getItem('ga_debug')：默认关闭调试逃生门
    localStorage: { getItem: () => null },
  }
  ;(globalThis as { window?: unknown }).window = fake
  return fake
}

/** 取最近一次推进 dataLayer 的那一条 */
function lastPushed(fake: FakeWindow): IArguments {
  const layer = fake.dataLayer ?? []
  return layer[layer.length - 1] as IArguments
}

/** 把 dataLayer 里推进去的 arguments 转成可读元组，便于断言顺序 */
function pushedEntries(fake: FakeWindow): Array<unknown[]> {
  return (fake.dataLayer ?? []).map((item) => Array.from(item as IArguments))
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window
  vi.restoreAllMocks()
})

describe('track（GA4 自定义事件上报）', () => {
  it('SSR 下（没有 window）直接返回，不抛错', () => {
    expect(() => track('login', { method: 'email_code' })).not.toThrow()
  })

  it('非生产域名一律 no-op：localhost 与预览域名都不发', () => {
    for (const host of ['localhost', '127.0.0.1', 'seichigo.pages.dev', 'seichigo.com.evil.com']) {
      const fake = setWindow(host)
      track('login', { method: 'email_code' })
      expect(fake.dataLayer).toBeUndefined()
      expect(fake.__seichigoGaConfigured).toBeUndefined()
    }
  })

  it('首次 track 先补 js+config 再发 event，顺序是 js → config → event', () => {
    const fake = setWindow('seichigo.com')
    track('login', { method: 'email_code' })

    const entries = pushedEntries(fake)
    expect(entries).toHaveLength(3)
    expect(entries[0]?.[0]).toBe('js')
    expect(entries[0]?.[1]).toBeInstanceOf(Date)
    expect(entries[1]?.[0]).toBe('config')
    expect(entries[1]?.[1]).toBe(GA_MEASUREMENT_ID)
    expect(entries[2]?.[0]).toBe('event')
    expect(entries[2]?.[1]).toBe('login')
    expect(fake.__seichigoGaConfigured).toBe(true)
  })

  it('第二次 track 不再补 config，只发 event', () => {
    const fake = setWindow('seichigo.com')
    track('login', { method: 'email_code' })
    track('share', { method: 'copy', content_type: 'article' })

    const entries = pushedEntries(fake)
    // 1 次 js + 1 次 config + 2 次 event
    expect(entries).toHaveLength(4)
    expect(entries.filter((entry) => entry[0] === 'config')).toHaveLength(1)
    expect(entries.filter((entry) => entry[0] === 'event')).toHaveLength(2)
  })

  it('__seichigoGaConfigured 已置位（layout 内联脚本已跑过）时不再补 config', () => {
    const fake = setWindow('seichigo.com')
    fake.__seichigoGaConfigured = true
    track('login', { method: 'email_code' })

    const entries = pushedEntries(fake)
    expect(entries).toHaveLength(1)
    expect(entries[0]?.[0]).toBe('event')
    // 标记仍保持置位，不被 track 重新改写
    expect(fake.__seichigoGaConfigured).toBe(true)
  })

  it('生产域名与其子域都上报', () => {
    for (const host of ['seichigo.com', 'www.seichigo.com']) {
      const fake = setWindow(host)
      track('login', { method: 'email_code' })
      // js + config + event 共三条
      expect(fake.dataLayer).toHaveLength(3)
    }
  })

  it('推进 dataLayer 的是 arguments 对象而不是数组，且 [0] 为 event', () => {
    const fake = setWindow('seichigo.com')
    track('begin_checkout', { tier: 'standard' })

    const pushed = lastPushed(fake)
    expect(Array.isArray(pushed)).toBe(false)
    expect(Object.prototype.toString.call(pushed)).toBe('[object Arguments]')
    expect(pushed.length).toBe(3)
    expect(pushed[0]).toBe('event')
    expect(pushed[1]).toBe('begin_checkout')
    expect(pushed[2]).toMatchObject({ tier: 'standard' })
  })

  it('值为 undefined 的参数被过滤掉', () => {
    const fake = setWindow('seichigo.com')
    track('plan_generated', { days: 3, points_count: undefined })

    const params = lastPushed(fake)[2] as Record<string, unknown>
    expect(params.days).toBe(3)
    expect('points_count' in params).toBe(false)
  })

  it('字符串参数截断到 100 字符，数字与布尔原样保留', () => {
    const fake = setWindow('seichigo.com')
    track('plan_start', { entry: 'x'.repeat(250), suggestion: true, days: 7 })

    const params = lastPushed(fake)[2] as Record<string, unknown>
    expect(params.entry).toBe('x'.repeat(100))
    expect(params.suggestion).toBe(true)
    expect(params.days).toBe(7)
  })

  it('GA 归因保留参数名（source/medium/campaign 等）在类型层面被禁掉', () => {
    const fake = setWindow('seichigo.com')
    // @ts-expect-error source 是 GA4 会话流量归因的保留参数名，AnalyticsParams 类型护栏应报错
    track('map_point_open', { bangumi_id: 1, source: 'marker' })
    // 运行时护栏只挡类型不挡执行：误传了也照常上报，不抛错
    expect((lastPushed(fake)[2] as Record<string, unknown>).source).toBe('marker')
  })

  it('按路径前缀自动带上 locale，调用方传了以调用方为准', () => {
    const cases: Array<[string, string]> = [
      ['/', 'zh'],
      ['/map', 'zh'],
      ['/en', 'en'],
      ['/en/plan/start', 'en'],
      ['/ja/posts/foo', 'ja'],
      // 前缀必须是完整的一段，/english 不算 en
      ['/english', 'zh'],
    ]
    for (const [pathname, expected] of cases) {
      const fake = setWindow('seichigo.com', pathname)
      track('map_anime_select', { bangumi_id: 1 })
      expect((lastPushed(fake)[2] as Record<string, unknown>).locale).toBe(expected)
    }

    const fake = setWindow('seichigo.com', '/en/map')
    track('map_anime_select', { bangumi_id: 1, locale: 'ja' })
    expect((lastPushed(fake)[2] as Record<string, unknown>).locale).toBe('ja')
  })

  it('ga_debug=1 + 非生产域名：只打 console.debug，不推 dataLayer', () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => undefined)
    const fake = setWindow('localhost')
    fake.localStorage = { getItem: (key: string) => (key === 'ga_debug' ? '1' : null) }

    track('login', { method: 'email_code' })

    expect(fake.dataLayer).toBeUndefined()
    expect(fake.__seichigoGaConfigured).toBeUndefined()
    expect(debugSpy).toHaveBeenCalledTimes(1)
    expect(debugSpy.mock.calls[0]?.[0]).toBe('[ga]')
    expect(debugSpy.mock.calls[0]?.[1]).toBe('login')
    expect(debugSpy.mock.calls[0]?.[2]).toMatchObject({ method: 'email_code', locale: 'zh' })
  })

  it('ga_debug=1 + 生产域名：仍正常推 dataLayer，同时也打日志', () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => undefined)
    const fake = setWindow('seichigo.com')
    fake.localStorage = { getItem: (key: string) => (key === 'ga_debug' ? '1' : null) }

    track('login', { method: 'email_code' })

    expect(fake.dataLayer).toHaveLength(3)
    expect(debugSpy).toHaveBeenCalledTimes(1)
  })

  it('读 localStorage 抛错按未开启调试处理，不影响主流程', () => {
    const fake = setWindow('localhost')
    fake.localStorage = {
      getItem: () => {
        throw new Error('denied')
      },
    }
    expect(() => track('login', { method: 'email_code' })).not.toThrow()
    expect(fake.dataLayer).toBeUndefined()
  })

  it('内部抛错不外泄：dataLayer.push 炸了也只是静默丢掉这次上报', () => {
    const fake = setWindow('seichigo.com')
    fake.dataLayer = {
      push() {
        throw new Error('boom')
      },
    } as unknown as unknown[]

    expect(() => track('share', { method: 'copy', content_type: 'article' })).not.toThrow()
  })

  it('读 location 抛错同样被吞掉', () => {
    const fake = { get location(): { hostname: string; pathname: string } {
      throw new Error('boom')
    } }
    ;(globalThis as { window?: unknown }).window = fake

    expect(() => track('sign_up', { method: 'email_code' })).not.toThrow()
  })
})
