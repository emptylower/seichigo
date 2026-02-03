import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import HeaderPublic from '@/components/layout/HeaderPublic'

vi.mock('next/navigation', () => ({
  usePathname: vi.fn(() => '/en'),
  useRouter: vi.fn(() => ({ push: vi.fn() })),
}))

describe('HeaderPublic', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders language switcher outside overflow container', () => {
    const { container } = render(<HeaderPublic locale="en" />)
    
    const overflowNav = container.querySelector('nav[class*="overflow-x-auto"]')
    expect(overflowNav).toBeTruthy()
    
    const languageSwitcher = container.querySelector('details')
    expect(languageSwitcher).toBeTruthy()
    
    expect(overflowNav?.contains(languageSwitcher as Node)).toBe(false)
    
    const controlsGroup = languageSwitcher?.parentElement
    expect(controlsGroup?.className).toMatch(/shrink-0/)
    
    const headerContainer = overflowNav?.parentElement
    expect(headerContainer?.contains(controlsGroup as Node)).toBe(true)
    expect(headerContainer?.contains(overflowNav)).toBe(true)
  })
  
  it('renders auth controls outside overflow container', () => {
    const { container } = render(<HeaderPublic locale="zh" />)
    
    const overflowNav = container.querySelector('nav[class*="overflow-x-auto"]')
    expect(overflowNav).toBeTruthy()
    
    const signInLink = Array.from(container.querySelectorAll('a')).find(
      a => a.textContent === '登录' || a.textContent === 'Sign In'
    )
    expect(signInLink).toBeTruthy()
    
    expect(overflowNav?.contains(signInLink as Node)).toBe(false)
  })
  
  it('keeps navigation links inside overflow container', () => {
    const { container } = render(<HeaderPublic locale="en" />)
    
    const overflowNav = container.querySelector('nav[class*="overflow-x-auto"]')
    expect(overflowNav).toBeTruthy()
    
    const postsLink = Array.from(container.querySelectorAll('a')).find(
      a => a.textContent === 'Posts'
    )
    const animeLink = Array.from(container.querySelectorAll('a')).find(
      a => a.textContent === 'Anime'
    )
    
    expect(overflowNav?.contains(postsLink as Node)).toBe(true)
    expect(overflowNav?.contains(animeLink as Node)).toBe(true)
  })
  
  it('applies shrink-0 to controls group', () => {
    const { container } = render(<HeaderPublic locale="ja" />)
    
    const languageSwitcher = container.querySelector('details')
    const controlsGroup = languageSwitcher?.parentElement
    
    expect(controlsGroup).toBeTruthy()
    expect(controlsGroup?.className).toMatch(/shrink-0/)
  })
})
