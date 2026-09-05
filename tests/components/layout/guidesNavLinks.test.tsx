import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import Footer from '@/components/layout/Footer'
import HeaderPublic from '@/components/layout/HeaderPublic'

vi.mock('next/navigation', () => ({
  usePathname: vi.fn(() => '/en'),
  useRouter: vi.fn(() => ({ push: vi.fn() })),
}))

vi.mock('next-auth/react', () => ({
  useSession: vi.fn(() => ({ data: null, status: 'unauthenticated' })),
  SessionProvider: ({ children }: { children: React.ReactNode }) => children,
}))

describe('攻略入口指向 /posts 索引页', () => {
  it('桌面页眉的「热门攻略」指向 /en/posts', () => {
    const { container } = render(<HeaderPublic locale="en" />)

    const link = Array.from(container.querySelectorAll('nav a')).find((a) => a.textContent === 'Top Guides')
    expect(link).toHaveAttribute('href', '/en/posts')
  })

  it('移动端抽屉的「热门攻略」指向 /en/posts', async () => {
    render(<HeaderPublic locale="en" />)

    fireEvent.click(screen.getByTestId('header-mobile-menu-trigger'))

    const links = await screen.findAllByRole('link', { name: /Top Guides/ })
    expect(links.some((a) => a.getAttribute('href') === '/en/posts')).toBe(true)
  })

  it('页脚的攻略入口指向 /posts', () => {
    const { container } = render(<Footer locale="zh" />)

    const link = Array.from(container.querySelectorAll('a')).find((a) => a.textContent === '文章')
    expect(link).toHaveAttribute('href', '/posts')
  })
})
