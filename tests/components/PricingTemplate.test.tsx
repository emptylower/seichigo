import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import PricingTemplate from '@/components/pricing/PricingTemplate'

const CJK = /[一-龥ぁ-ヿ]/

describe('PricingTemplate', () => {
  it('zh：标题、三档卡片、功能表与页脚说明', () => {
    render(<PricingTemplate locale="zh" />)
    expect(screen.getByRole('heading', { level: 1, name: '选择你的巡礼规划套餐' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: /免费/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '开通标准版' })).toHaveAttribute('href', '/plan?upgrade=standard')
    expect(screen.getByText('真实路线 + 日本公交')).toBeInTheDocument()
    expect(screen.getByText('高级档全部功能即将推出。')).toBeInTheDocument()
  })

  it('en：全英文，无中日文残留', () => {
    const { container } = render(<PricingTemplate locale="en" />)
    expect(screen.getByRole('heading', { level: 1, name: 'Pick the plan that fits your pilgrimage' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Get Standard' })).toHaveAttribute('href', '/plan?upgrade=standard')
    expect(screen.getByText('Up to 3 days')).toBeInTheDocument()
    expect(screen.getAllByText('Coming soon').length).toBeGreaterThan(0)
    expect(CJK.test(container.textContent ?? ''), container.textContent ?? '').toBe(false)
  })

  it('ja：日文标题与功能表', () => {
    render(<PricingTemplate locale="ja" />)
    expect(screen.getByRole('heading', { level: 1, name: '巡礼プランニングのプランをお選びください' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '近日公開' })).toBeDisabled()
    expect(screen.getByText('実際のルート＋日本の公共交通')).toBeInTheDocument()
    expect(screen.getByText('毎月のエージェント利用量')).toBeInTheDocument()
  })

  it('三语都不出现 credit / token / 成本 / 调用次数', () => {
    for (const locale of ['zh', 'en', 'ja'] as const) {
      const { container, unmount } = render(<PricingTemplate locale={locale} />)
      const text = container.textContent ?? ''
      expect(/credit|token|成本|调用次数/i.test(text), `${locale}: ${text}`).toBe(false)
      unmount()
    }
  })

  it('功能表每行三档都有取值', () => {
    const { container } = render(<PricingTemplate locale="en" />)
    const rows = within(container).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(9)
    for (const row of rows) expect(within(row).getAllByRole('cell')).toHaveLength(4)
  })
})
