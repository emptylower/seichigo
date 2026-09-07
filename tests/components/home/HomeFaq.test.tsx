import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import HomeFaq from '@/components/home/HomeFaq'

describe('HomeFaq（第六屏：五条问答 + 收尾标题）', () => {
  it('渲染五条新问题与标题/副标题', () => {
    render(<HomeFaq locale="zh" />)

    expect(screen.getByText('常见问题')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '你可能会关心这些问题' })).toBeInTheDocument()
    for (const question of [
      '什么是圣地巡礼？',
      '规划师是怎么排行程的？',
      '免费能用到什么？',
      '点位数据从哪来？',
      '可以自己改行程吗？',
    ]) {
      expect(screen.getByText(question)).toBeInTheDocument()
    }
  })

  it('第一条默认展开，其余折叠', () => {
    const { container } = render(<HomeFaq locale="zh" />)

    const details = [...container.querySelectorAll('details')]
    expect(details).toHaveLength(5)
    expect(details[0]!.hasAttribute('open')).toBe(true)
    for (const rest of details.slice(1)) {
      expect(rest.hasAttribute('open')).toBe(false)
    }
  })

  it('FAQPage JSON-LD 与五条问答一致', () => {
    const { container } = render(<HomeFaq locale="zh" />)

    const script = container.querySelector('script[type="application/ld+json"]')!
    const json = JSON.parse(script.textContent ?? '{}') as {
      '@type': string
      mainEntity: Array<{ name: string }>
    }
    expect(json['@type']).toBe('FAQPage')
    expect(json.mainEntity).toHaveLength(5)
    expect(json.mainEntity[0]!.name).toBe('什么是圣地巡礼？')
  })

  it('en locale 出英文问答', () => {
    render(<HomeFaq locale="en" />)
    expect(screen.getByText('What is an anime pilgrimage?')).toBeInTheDocument()
    expect(screen.getByText('What can I use for free?')).toBeInTheDocument()
  })
})
