import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import HeaderPublic from '@/components/layout/HeaderPublic'

vi.mock('next/navigation', () => ({
  usePathname: vi.fn(() => '/en'),
  useRouter: vi.fn(() => ({ push: vi.fn() })),
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
    expect(nav?.textContent).toContain('Posts')
    expect(nav?.textContent).toContain('Anime')
    expect(nav?.textContent).toContain('Map')
    expect(nav?.textContent).toContain('Resources')
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
