import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import Footer from '@/components/layout/Footer'
import HeaderPublic from '@/components/layout/HeaderPublic'
import HomeEntryCards from '@/components/home/HomeEntryCards'

vi.mock('next/navigation', () => ({
  usePathname: vi.fn(() => '/'),
  useRouter: vi.fn(() => ({ push: vi.fn() })),
}))

vi.mock('next-auth/react', () => ({
  useSession: vi.fn(() => ({ data: null, status: 'unauthenticated' })),
  SessionProvider: ({ children }: { children: React.ReactNode }) => children,
}))

type Locale = 'zh' | 'en' | 'ja'

/** §3.2 名称表：四个核心入口逐字一致；pricing/anime/resources 沿用字典现值 */
const NAV_EXPECT: Record<Locale, { label: string; href: string }[]> = {
  zh: [
    { label: '巡礼地图', href: '/map' },
    { label: '巡礼攻略', href: '/posts' },
    { label: 'AI 规划', href: '/plan/start' },
    { label: '巡礼城市', href: '/city' },
    { label: '套餐', href: '/pricing' },
  ],
  en: [
    { label: 'Pilgrimage Map', href: '/en/map' },
    { label: 'Pilgrimage Guides', href: '/en/posts' },
    { label: 'AI Planner', href: '/en/plan/start' },
    { label: 'Pilgrimage Cities', href: '/en/city' },
    { label: 'Pricing', href: '/en/pricing' },
  ],
  ja: [
    { label: '巡礼マップ', href: '/ja/map' },
    { label: '巡礼ガイド', href: '/ja/posts' },
    { label: 'AIプランナー', href: '/ja/plan/start' },
    { label: '都市ガイド', href: '/ja/city' },
    { label: 'プラン', href: '/ja/pricing' },
  ],
}

const FOOTER_PRODUCT_EXPECT: Record<Locale, { label: string; href: string }[]> = {
  zh: [
    { label: '巡礼地图', href: '/map' },
    { label: '巡礼攻略', href: '/posts' },
    { label: 'AI 规划', href: '/plan/start' },
    { label: '巡礼城市', href: '/city' },
    { label: '套餐', href: '/pricing' },
    { label: '作品', href: '/anime' },
    { label: '资源', href: '/resources' },
  ],
  en: [
    { label: 'Pilgrimage Map', href: '/en/map' },
    { label: 'Pilgrimage Guides', href: '/en/posts' },
    { label: 'AI Planner', href: '/en/plan/start' },
    { label: 'Pilgrimage Cities', href: '/en/city' },
    { label: 'Pricing', href: '/en/pricing' },
    { label: 'Anime', href: '/en/anime' },
    { label: 'Resources', href: '/en/resources' },
  ],
  ja: [
    { label: '巡礼マップ', href: '/ja/map' },
    { label: '巡礼ガイド', href: '/ja/posts' },
    { label: 'AIプランナー', href: '/ja/plan/start' },
    { label: '都市ガイド', href: '/ja/city' },
    { label: 'プラン', href: '/ja/pricing' },
    { label: '作品', href: '/ja/anime' },
    { label: 'リソース', href: '/ja/resources' },
  ],
}

const ENTRY_CARD_TITLE_EXPECT: Record<Locale, string[]> = {
  zh: ['巡礼地图', '巡礼攻略'],
  en: ['Pilgrimage Map', 'Pilgrimage Guides'],
  ja: ['巡礼マップ', '巡礼ガイド'],
}

const FOOTER_PRODUCT_TITLE: Record<Locale, string> = {
  zh: '产品',
  en: 'Product',
  ja: 'プロダクト',
}

describe.each(['zh', 'en', 'ja'] as const)('公共导航一致性（%s）', (locale) => {
  it('桌面页头：map → posts → plan/start → city → pricing，名称与 href 逐字一致', () => {
    const { container } = render(<HeaderPublic locale={locale} />)

    const nav = container.querySelector('nav')
    expect(nav).toBeTruthy()
    const links = Array.from(nav!.querySelectorAll('a')).slice(0, 5)

    expect(links.map((a) => a.textContent)).toEqual(NAV_EXPECT[locale].map((e) => e.label))
    expect(links.map((a) => a.getAttribute('href'))).toEqual(NAV_EXPECT[locale].map((e) => e.href))
  })

  it('移动抽屉（限定 dialog 内查询）：同一份名称、href 与顺序', async () => {
    render(<HeaderPublic locale={locale} />)

    fireEvent.click(screen.getByTestId('header-mobile-menu-trigger'))
    const dialog = await screen.findByRole('dialog')

    const nav = within(dialog).getByRole('navigation')
    expect(nav).toBeTruthy()
    const links = Array.from(nav!.querySelectorAll('a')).slice(0, 5)

    expect(links.map((a) => a.textContent)).toEqual(NAV_EXPECT[locale].map((e) => e.label))
    expect(links.map((a) => a.getAttribute('href'))).toEqual(NAV_EXPECT[locale].map((e) => e.href))
  })

  it('页脚产品列：map → posts → plan/start → city → pricing → anime → resources', () => {
    const { container } = render(<Footer locale={locale} />)

    const heading = within(container).getByRole('heading', { name: FOOTER_PRODUCT_TITLE[locale] })
    const column = heading.parentElement
    expect(column).toBeTruthy()
    const links = Array.from(column!.querySelectorAll('a'))

    expect(links.map((a) => a.textContent)).toEqual(FOOTER_PRODUCT_EXPECT[locale].map((e) => e.label))
    expect(links.map((a) => a.getAttribute('href'))).toEqual(FOOTER_PRODUCT_EXPECT[locale].map((e) => e.href))
  })

  it('首页入口卡标题节点与导航名称逐字一致（只比较标题节点）', () => {
    const { container } = render(<HomeEntryCards locale={locale} />)

    const cards = Array.from(container.querySelectorAll('.grid a'))
    expect(cards).toHaveLength(2)
    const titles = cards.map((a) => a.querySelector('span.font-semibold')?.textContent)

    expect(titles).toEqual(ENTRY_CARD_TITLE_EXPECT[locale])
  })
})
