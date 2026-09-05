import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import HeaderPublic from '@/components/layout/HeaderPublic'

vi.mock('next/navigation', () => ({
  usePathname: vi.fn(() => '/en'),
  useRouter: vi.fn(() => ({ push: vi.fn() })),
}))

vi.mock('next-auth/react', () => ({
  useSession: vi.fn(() => ({ data: null, status: 'unauthenticated' })),
  SessionProvider: ({ children }: { children: React.ReactNode }) => children,
}))

describe('HeaderPublic', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders mobile menu trigger for compact viewports', () => {
    render(<HeaderPublic locale="en" />)

    const trigger = screen.getByTestId('header-mobile-menu-trigger')
    expect(trigger).toBeInTheDocument()
    expect(trigger).toHaveAttribute('aria-label', 'Open menu')
  })

  it('keeps primary navigation links in desktop navigation area', () => {
    const { container } = render(<HeaderPublic locale="en" />)

    const nav = container.querySelector('nav')
    expect(nav).toBeTruthy()
    expect(nav?.textContent).toContain('Plan')
    expect(nav?.textContent).toContain('Map')
    expect(nav?.textContent).toContain('Top Guides')
    expect(nav?.textContent).toContain('Top Cities')
    expect(nav?.textContent).not.toContain('Me')
    expect(nav?.textContent).toContain('Community')
  })

  it('opens the QQ community dropdown from the desktop navigation', async () => {
    render(<HeaderPublic locale="zh" />)

    fireEvent.keyDown(screen.getByTestId('header-community-trigger'), { key: 'Enter' })

    expect(await screen.findByText('SeichiGo QQ 群')).toBeInTheDocument()
    expect(screen.getByText(/901491088/)).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'SeichiGo QQ 群二维码' })).toBeInTheDocument()
  })

  it('expands the QQ community details inside the mobile drawer navigation', async () => {
    render(<HeaderPublic locale="zh" />)

    fireEvent.click(screen.getByTestId('header-mobile-menu-trigger'))
    const trigger = await screen.findByTestId('header-community-drawer-trigger')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(trigger)

    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('使用 QQ 扫码加入群聊')).toBeInTheDocument()
  })

  it('renders language switcher and auth controls in desktop controls', () => {
    const { container } = render(<HeaderPublic locale="zh" />)

    const languageSwitcher = container.querySelector('details')
    expect(languageSwitcher).toBeTruthy()

    const signInLink = Array.from(container.querySelectorAll('a')).find(
      (a) => a.textContent === '登录' || a.textContent === 'Sign In'
    )
    expect(signInLink).toBeTruthy()
  })
})
