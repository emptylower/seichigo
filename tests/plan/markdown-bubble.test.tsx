import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { MarkdownBubble } from '@/app/(authed)/plan/[id]/components/MarkdownBubble'

describe('MarkdownBubble', () => {
  it('renders markdown bold, lists and headings as HTML', () => {
    const { container } = render(<MarkdownBubble text={'## 第 1 天\n\n**重点**\n- 项目一\n- 项目二'} />)
    expect(container.querySelector('h2')?.textContent).toBe('第 1 天')
    expect(container.querySelector('strong')?.textContent).toBe('重点')
    expect(container.querySelectorAll('li')).toHaveLength(2)
    expect(container.innerHTML).not.toContain('**重点**')
  })

  it('renders links with safe target/rel', () => {
    const { container } = render(<MarkdownBubble text="[参考](https://example.com)" />)
    const link = container.querySelector('a')
    expect(link?.getAttribute('href')).toBe('https://example.com')
    expect(link?.getAttribute('target')).toBe('_blank')
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('strips unsafe html and js urls', () => {
    const { container } = render(<MarkdownBubble text={'<script>alert(1)</script>安全 [x](javascript:alert(1))'} />)
    expect(container.innerHTML).not.toContain('<script>')
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull()
    expect(container.textContent).toContain('安全')
  })
})
