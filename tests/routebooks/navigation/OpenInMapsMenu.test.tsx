import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, fireEvent, render, renderHook, screen, within } from '@testing-library/react'
import { OpenInMapsMenu, OpenInMapsOptions } from '@/components/navigation/OpenInMapsMenu'
import {
  APP_FALLBACK_MS,
  detectNavPlatform,
  launchAppWithFallback,
  toAndroidIntentUrl,
  useMaxNavWaypoints,
} from '@/components/navigation/navLaunch'
import { renderToString } from 'react-dom/server'
import { buildDayTargets, buildSingleTargets } from '@/lib/route/navigationTargets'

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Mobile Safari/537.36'

const DAY_STOPS = [
  { lat: 35.68, lng: 139.76, name: '东京站' },
  { lat: 35.66, lng: 139.7, name: '涩谷' },
  { lat: 35.69, lng: 139.7, name: '新宿' },
]

function mockUserAgent(ua: string) {
  vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(ua)
}

function mockVisibility(state: DocumentVisibilityState) {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(state)
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('OpenInMapsMenu', () => {
  it('下拉渲染 Google / Apple 地图 / 高德地图三项，Apple 整天标「仅起终点」', () => {
    render(<OpenInMapsMenu targets={buildDayTargets(DAY_STOPS, 'transit')} locale="zh" />)
    fireEvent.click(screen.getByRole('button', { name: '打开导航' }))
    const menu = screen.getByRole('menu', { name: '选择地图应用' })
    const items = within(menu).getAllByRole('menuitem')
    expect(items).toHaveLength(3)
    expect(within(menu).getByRole('menuitem', { name: /Google 地图/ }).getAttribute('href')).toContain(
      'google.com/maps/dir'
    )
    expect(within(menu).getByRole('menuitem', { name: /Apple 地图/ }).textContent).toContain('仅起终点')
    expect(within(menu).getByRole('menuitem', { name: /高德地图/ }).getAttribute('href')).toContain('ditu.amap.com/dir')
  })

  it('单点目标不标「仅起终点」；英文文案', () => {
    render(<OpenInMapsMenu targets={buildSingleTargets(DAY_STOPS[0]!, 'walking')} locale="en" />)
    fireEvent.click(screen.getByRole('button', { name: 'Navigate' }))
    expect(screen.getByRole('menuitem', { name: /Apple Maps/ }).textContent).not.toContain('Start & end only')
    expect(screen.getByRole('menuitem', { name: /Google Maps/ }).getAttribute('href')).toContain('travelmode=walking')
  })

  it('没有目标时触发按钮禁用', () => {
    render(<OpenInMapsMenu targets={[]} locale="zh" />)
    expect(screen.getByRole('button', { name: '打开导航' })).toBeDisabled()
  })

  it('点外部 / Esc 关闭下拉', () => {
    render(<OpenInMapsMenu targets={buildDayTargets(DAY_STOPS, 'transit')} locale="zh" />)
    fireEvent.click(screen.getByRole('button', { name: '打开导航' }))
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '打开导航' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('sheet 形态渲染为对话框', () => {
    render(<OpenInMapsMenu targets={buildDayTargets(DAY_STOPS, 'transit')} locale="ja" presentation="sheet" />)
    fireEvent.click(screen.getByRole('button', { name: 'ナビを開く' }))
    const dialog = screen.getByRole('dialog', { name: '地図アプリで開く' })
    expect(within(dialog).getAllByRole('link')).toHaveLength(3)
  })

  it('Google 整天超出 waypoints 上限时按段列出', () => {
    const stops = Array.from({ length: 8 }, (_, i) => ({ lat: 35 + i * 0.01, lng: 139 + i * 0.01, name: `S${i}` }))
    render(<OpenInMapsOptions targets={buildDayTargets(stops, 'transit', { maxWaypoints: 3 })} locale="zh" />)
    const googleRows = screen.getAllByRole('link', { name: /Google 地图 · 第 \d\/2 段/ })
    expect(googleRows).toHaveLength(2)
  })
})

describe('排序（按平台 / 语言）', () => {
  function providers() {
    return screen.getAllByRole('link').map((link) => link.getAttribute('data-provider'))
  }

  it('iOS → apple, google, amap', () => {
    mockUserAgent(IPHONE_UA)
    render(<OpenInMapsOptions targets={buildDayTargets(DAY_STOPS, 'transit')} locale="en" />)
    expect(providers()).toEqual(['apple', 'google', 'amap'])
  })

  it('中文非 iOS → amap, google, apple', () => {
    mockUserAgent(ANDROID_UA)
    render(<OpenInMapsOptions targets={buildDayTargets(DAY_STOPS, 'transit')} locale="zh" />)
    expect(providers()).toEqual(['amap', 'google', 'apple'])
  })

  it('其余 → google, apple, amap', () => {
    render(<OpenInMapsOptions targets={buildDayTargets(DAY_STOPS, 'transit')} locale="ja" />)
    expect(providers()).toEqual(['google', 'apple', 'amap'])
  })

  it('首次渲染即按平台排序（不等 effect，打开菜单不闪动，G14）', () => {
    mockUserAgent(IPHONE_UA)
    const html = renderToString(<OpenInMapsOptions targets={buildDayTargets(DAY_STOPS, 'transit')} locale="zh" />)
    const order = Array.from(html.matchAll(/data-provider="(\w+)"/g)).map((m) => m[1])
    expect(order).toEqual(['apple', 'google', 'amap'])
  })

  it('detectNavPlatform：iPadOS 桌面 UA 按触点识别为 iOS', () => {
    expect(detectNavPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5)).toEqual({ isIOS: true, isAndroid: false })
    expect(detectNavPlatform(ANDROID_UA)).toEqual({ isIOS: false, isAndroid: true })
  })
})

describe('高德 app 唤起回退（iOS 计时器 / Android intent，G2）', () => {
  it('iOS：1.6 秒内页面仍可见 → 新开网页回退，settle(web)', () => {
    vi.useFakeTimers()
    mockVisibility('visible')
    const open = vi.spyOn(window, 'open').mockReturnValue({ opener: {} } as Window)
    const assign = vi.fn()
    const onSettled = vi.fn()
    launchAppWithFallback('iosamap://path?x=1', 'https://ditu.amap.com/dir?x=1', { assign, onSettled })
    expect(assign).toHaveBeenCalledWith('iosamap://path?x=1')
    act(() => {
      vi.advanceTimersByTime(APP_FALLBACK_MS - 1)
    })
    expect(open).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(open).toHaveBeenCalledWith('https://ditu.amap.com/dir?x=1', '_blank')
    expect(onSettled).toHaveBeenCalledWith('web')
  })

  it('iOS：页面转入后台（visibilitychange→hidden）后又回到前台 → 不再打开网页版', () => {
    vi.useFakeTimers()
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const assign = vi.fn()
    const onSettled = vi.fn()
    launchAppWithFallback('iosamap://path?x=1', 'https://ditu.amap.com/dir?x=1', { assign, onSettled })
    visibility.mockReturnValue('hidden')
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    visibility.mockReturnValue('visible')
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
      vi.advanceTimersByTime(APP_FALLBACK_MS * 2)
    })
    expect(open).not.toHaveBeenCalled()
    expect(assign).toHaveBeenCalledTimes(1)
    expect(onSettled).toHaveBeenCalledTimes(1)
    expect(onSettled).toHaveBeenCalledWith('app')
  })

  it('iOS：pagehide / blur 同样清除计时器', () => {
    vi.useFakeTimers()
    mockVisibility('visible')
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    launchAppWithFallback('iosamap://a', 'https://ditu.amap.com/dir?a=1', { assign: vi.fn() })
    act(() => {
      window.dispatchEvent(new Event('pagehide'))
    })
    launchAppWithFallback('iosamap://b', 'https://ditu.amap.com/dir?b=1', { assign: vi.fn() })
    act(() => {
      window.dispatchEvent(new Event('blur'))
      vi.advanceTimersByTime(APP_FALLBACK_MS)
    })
    expect(open).not.toHaveBeenCalled()
  })

  it('iOS：新窗口被拦截 → 不在当前 tab 跳转，settle(blocked)', () => {
    vi.useFakeTimers()
    mockVisibility('visible')
    vi.spyOn(window, 'open').mockReturnValue(null)
    const assign = vi.fn()
    const onSettled = vi.fn()
    launchAppWithFallback('iosamap://x', 'https://ditu.amap.com/dir?y=1', { assign, onSettled })
    act(() => {
      vi.advanceTimersByTime(APP_FALLBACK_MS)
    })
    expect(assign).toHaveBeenCalledTimes(1)
    expect(assign).not.toHaveBeenCalledWith('https://ditu.amap.com/dir?y=1')
    expect(onSettled).toHaveBeenCalledWith('blocked')
  })

  it('Android：改用 intent URL（带包名与 browser_fallback_url），不起计时器', () => {
    vi.useFakeTimers()
    mockVisibility('visible')
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const assign = vi.fn()
    const onSettled = vi.fn()
    const web = 'https://ditu.amap.com/dir?from[lnglat]=1,2&type=bus'
    launchAppWithFallback('amapuri://route/plan/?sourceApplication=seichigo&dlat=1', web, { assign, onSettled })
    expect(assign).toHaveBeenCalledWith(
      `intent://route/plan/?sourceApplication=seichigo&dlat=1#Intent;scheme=amapuri;package=com.autonavi.minimap;S.browser_fallback_url=${encodeURIComponent(web)};end`
    )
    expect(onSettled).toHaveBeenCalledWith('app')
    act(() => {
      vi.advanceTimersByTime(APP_FALLBACK_MS * 2)
    })
    expect(open).not.toHaveBeenCalled()
    expect(assign).toHaveBeenCalledTimes(1)
    expect(toAndroidIntentUrl('iosamap://path', web)).toBeNull()
  })

  it('Android 上点高德项：不走默认链接、不开网页，点完即收起', () => {
    vi.useFakeTimers()
    mockUserAgent(ANDROID_UA)
    mockVisibility('visible')
    const open = vi.spyOn(window, 'open').mockReturnValue({ opener: {} } as Window)
    // jsdom 不实现 intent 跳转，静默它的 not-implemented 报错
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const onPicked = vi.fn()
    render(<OpenInMapsOptions targets={buildDayTargets(DAY_STOPS, 'transit')} locale="zh" onPicked={onPicked} />)
    const amap = screen.getByRole('link', { name: /高德地图/ })
    const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true })
    act(() => {
      amap.dispatchEvent(clickEvent)
    })
    expect(clickEvent.defaultPrevented).toBe(true)
    expect(onPicked).toHaveBeenCalledTimes(1)
    act(() => {
      vi.advanceTimersByTime(APP_FALLBACK_MS)
    })
    expect(open).not.toHaveBeenCalled()
  })

  it('iOS 上点高德项：网页回退被拦截 → 列表里出现「网页版」一行，点它才收起', () => {
    vi.useFakeTimers()
    mockUserAgent(IPHONE_UA)
    mockVisibility('visible')
    vi.spyOn(window, 'open').mockReturnValue(null)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const onPicked = vi.fn()
    render(<OpenInMapsOptions targets={buildDayTargets(DAY_STOPS, 'transit')} locale="zh" onPicked={onPicked} />)
    const amap = screen.getByRole('link', { name: /^高德地图$/ })
    act(() => {
      amap.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })
    expect(onPicked).not.toHaveBeenCalled()
    expect(screen.queryByRole('link', { name: /网页版/ })).toBeNull()
    act(() => {
      vi.advanceTimersByTime(APP_FALLBACK_MS)
    })
    const web = screen.getByRole('link', { name: '高德地图 · 网页版' })
    expect(web.getAttribute('href')).toBe(amap.getAttribute('href'))
    expect(web.getAttribute('target')).toBe('_blank')
    web.addEventListener('click', (event) => event.preventDefault())
    fireEvent.click(web)
    expect(onPicked).toHaveBeenCalledTimes(1)
  })
})

describe('useMaxNavWaypoints（G6）', () => {
  function mockCoarse(matches: boolean) {
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) =>
        ({
          matches: query === '(pointer: coarse)' ? matches : false,
          media: query,
          onchange: null,
          addListener: vi.fn(),
          removeListener: vi.fn(),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(),
        }) as MediaQueryList
    )
  }

  it('桌面（细指针 + 桌面 UA）→ 9', () => {
    mockCoarse(false)
    const { result } = renderHook(() => useMaxNavWaypoints())
    expect(result.current).toBe(9)
  })

  it('触屏（pointer: coarse）→ 3', () => {
    mockCoarse(true)
    const { result } = renderHook(() => useMaxNavWaypoints())
    expect(result.current).toBe(3)
  })

  it('移动 UA（即使 matchMedia 报细指针）→ 3', () => {
    mockCoarse(false)
    mockUserAgent(ANDROID_UA)
    const { result } = renderHook(() => useMaxNavWaypoints())
    expect(result.current).toBe(3)
  })
})
