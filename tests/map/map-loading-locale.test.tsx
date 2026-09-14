import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

// 让动态 chunk 永远 pending：dynamic() 的 loading fallback 会持续渲染，
// 从而覆盖「AnitabiMapPageLazy → dynamic loading 回调 → 模块级 Context → Skeleton」
// 这条真实 locale 传递链，而不是绕开 lazy 直接给 Skeleton 传 locale。
vi.mock('@/components/map/AnitabiMapPageClient', async () => {
  await new Promise(() => {})
  return { default: () => null }
})

import AnitabiMapPageLazy from '@/components/map/AnitabiMapPageLazy'

const CASES = [
  { locale: 'zh', title: '巡礼地图', loading: '加载中…' },
  { locale: 'en', title: 'Pilgrimage Map', loading: 'Loading…' },
  { locale: 'ja', title: '巡礼マップ', loading: '読み込み中…' },
] as const

describe('地图 loading 占位的 locale 传递链', () => {
  it.each(CASES)('locale=$locale：loading H1 与移动端标题取 header.map，说明取 common.loading', ({ locale, title, loading }) => {
    render(<AnitabiMapPageLazy locale={locale} />)

    // 桌面侧栏 H1（加载阶段唯一 H1）
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(title)
    // 移动端底部抽屉标题
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(title)
    // 占位说明统一用已有 common.loading
    expect(screen.getAllByText(loading)).toHaveLength(2)
  })
})
