import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import HomeMapDatabase from '@/components/home/HomeMapDatabase'
import { heroDemoFixture, mapWorldFixture, statsFixture } from './fixtures'

/**
 * 第二屏静态世界地图：不再有 MapLibre / IntersectionObserver，
 * 渲染结果完全由 world（home-map-world.json 契约）+ stats + demo 决定，同步可断言。
 */
describe('HomeMapDatabase（静态世界地图）', () => {
  it('渲染预渲染 <img>：srcSet 含 2x、width/height 写死（防 CLS）、lazy + async、alt 空且 aria-hidden', () => {
    const { container } = render(<HomeMapDatabase locale="zh" world={mapWorldFixture()} stats={statsFixture} />)

    const img = container.querySelector('img[src="/images/home/map-world.webp"]')!
    expect(img).not.toBeNull()
    expect(img.getAttribute('srcSet')).toContain('/images/home/map-world@2x.webp 2x')
    expect(img.getAttribute('width')).toBe('1208')
    expect(img.getAttribute('height')).toBe('441')
    expect(img.getAttribute('loading')).toBe('lazy')
    expect(img.getAttribute('decoding')).toBe('async')
    expect(img.getAttribute('alt')).toBe('')
    expect(img.getAttribute('aria-hidden')).toBe('true')
  })

  it('大数字取整到千位（50597 → 50,000）＋粉色加号，统计胶囊是真实数据（点位取 world.totalPoints 精确值）', () => {
    render(<HomeMapDatabase locale="zh" world={mapWorldFixture()} stats={statsFixture} demo={heroDemoFixture()} />)

    expect(screen.getByText('50,000')).toBeInTheDocument()
    expect(screen.getByText('+')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '巡礼点位，全部落在地图上' })).toBeInTheDocument()
    // 统计胶囊（桌面浮层 + 移动端横排两处同数据）：作品 1,234 / 巡礼点位 50,597（精确值）/ 攻略 87
    expect(screen.getAllByText('1,234').length).toBe(2)
    expect(screen.getAllByText('50,597').length).toBe(2)
    expect(screen.getAllByText('87').length).toBe(2)
    // 副标题由真实数据拼出
    expect(screen.getByText(/来自 1,234 部动漫作品 · 每天都在增加/)).toBeInTheDocument()
  })

  it('标签碰撞（B-2 四方位回退）：东京占上方、京都退下方，海外标签（伦敦/首尔/洛杉矶）全部保留', () => {
    render(<HomeMapDatabase locale="zh" world={mapWorldFixture()} />)

    const pills = [...document.querySelectorAll('[data-map-label]')]
    const names = pills.map((el) => el.getAttribute('data-map-label'))
    expect(names).toEqual(['东京', '京都', '伦敦', '洛杉矶', '首尔'])
    const anchorOf = (name: string) =>
      pills.find((el) => el.getAttribute('data-map-label') === name)!.getAttribute('data-map-anchor')
    expect(anchorOf('东京')).toBe('top')
    expect(anchorOf('京都')).toBe('bottom')
    expect(anchorOf('洛杉矶')).toBe('left')
    expect(anchorOf('首尔')).toBe('left')
  })

  it('primary（东京）的胶囊大一号、数字粉色加粗，其它城市 text-xs、数字深灰；标签按 locale 取名', () => {
    const { unmount } = render(<HomeMapDatabase locale="zh" world={mapWorldFixture()} />)
    const tokyoPill = document.querySelector('[data-map-label="东京"]')!
    expect(tokyoPill).toHaveClass('px-3', 'text-[13px]')
    const londonPill = document.querySelector('[data-map-label="伦敦"]')!
    expect(londonPill).toHaveClass('px-2.5', 'text-xs')
    expect(screen.getByText('13,959')).toHaveClass('text-brand-600', 'font-bold')
    expect(screen.getByText('666')).toHaveClass('text-gray-900', 'font-semibold')
    unmount()

    render(<HomeMapDatabase locale="en" world={mapWorldFixture()} />)
    const names = [...document.querySelectorAll('[data-map-label]')].map((el) => el.getAttribute('data-map-label'))
    expect(names).toEqual(['Tokyo', 'Kyoto', 'London', 'Los Angeles', 'Seoul'])
  })

  it('world 为 null 时整段不渲染（A 部分尚未落盘）', () => {
    const { container } = render(<HomeMapDatabase locale="zh" world={null} stats={statsFixture} />)
    expect(container.firstChild).toBeNull()
  })

  it('地图卡片右下角展示底图署名（CC BY-SA 3.0 许可要求）', () => {
    render(<HomeMapDatabase locale="zh" world={mapWorldFixture()} />)
    expect(screen.getByText(/TUBS \/ Wikimedia Commons, CC BY-SA 3\.0/)).toBeInTheDocument()
  })

  it('地图段根 section 带 id="home-showcase"（接住首屏滚动提示），CTA 指向 /map', () => {
    const { container } = render(<HomeMapDatabase locale="zh" world={mapWorldFixture()} stats={statsFixture} />)

    expect(container.querySelector('section#home-showcase')).not.toBeNull()
    expect(screen.getByRole('link', { name: /打开地图/ })).toHaveAttribute('href', '/map')
    expect(screen.getByText('免登录，随便逛')).toBeInTheDocument()
  })

  it('无 stats 时不渲染统计胶囊，副标题只剩「每天都在增加」', () => {
    render(<HomeMapDatabase locale="zh" world={mapWorldFixture()} />)

    expect(screen.queryByText('1,234')).toBeNull()
    expect(screen.getByText('每天都在增加')).toBeInTheDocument()
  })

  it('放大预览小卡：缩略图 + 3 个真实 marker（首个为选中大点）+ 8 个装饰点 + 点位小卡「点位名 · 《作品名》」', () => {
    const demo = heroDemoFixture()
    demo.day.items[0] = {
      ...demo.day.items[0]!,
      title: '你的名字・须贺神社男坂',
      titles: { zh: '你的名字・须贺神社男坂', en: 'Suga Shrine Steps', ja: '須賀神社の男坂' },
    }
    const { container } = render(<HomeMapDatabase locale="zh" world={mapWorldFixture()} demo={demo} />)

    expect(container.querySelector('img[src="/images/home/hero-phone-map.webp"]')).not.toBeNull()
    // 3 个真实 marker + 8 个装饰圆点
    expect(container.querySelectorAll('circle')).toHaveLength(11)
    // 选中点：大一号带白边
    expect(container.querySelector('circle[r="6.5"]')).not.toBeNull()
    expect(screen.getByText('东京 · 新宿区')).toBeInTheDocument()
    // B-2：title「作品名・点位名」显示成「点位名 · 《作品名》」
    expect(screen.getByText('须贺神社男坂')).toBeInTheDocument()
    expect(screen.getByText(/· 《你的名字》/)).toBeInTheDocument()
    expect(screen.queryByText('你的名字・须贺神社男坂')).toBeNull()
    expect(screen.getByText('每一个点都能点开看')).toBeInTheDocument()
  })

  it('放大预览小卡：title 没有「・」时原样显示（不加书名号）', () => {
    const demo = heroDemoFixture()
    render(<HomeMapDatabase locale="zh" world={mapWorldFixture()} demo={demo} />)

    // fixture 的 title 是「须贺神社男坂」（无「・」）
    expect(screen.getByText('须贺神社男坂')).toBeInTheDocument()
    expect(screen.queryByText(/《/)).toBeNull()
  })

  it('demo 或 demo.map 缺失时不渲染放大预览小卡', () => {
    const demo = heroDemoFixture()
    delete demo.map
    render(<HomeMapDatabase locale="zh" world={mapWorldFixture()} demo={demo} />)

    expect(screen.queryByText('每一个点都能点开看')).toBeNull()
    expect(screen.queryByText('东京 · 新宿区')).toBeNull()
  })
})
