import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import HomeBrowse from '@/components/home/HomeBrowse'
import { popularAnimeFixture, popularCitiesFixture } from './fixtures'

describe('HomeBrowse（热门作品 + 热门城市合并段）', () => {
  it('一段里同时给出作品列与城市列', () => {
    render(<HomeBrowse locale="zh" anime={popularAnimeFixture(3)} cities={popularCitiesFixture(3)} />)

    expect(screen.getByRole('heading', { name: '按作品和城市浏览' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '热门作品' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '热门城市' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '全部作品' })).toHaveAttribute('href', '/anime')
    expect(screen.getByRole('link', { name: '全部城市' })).toHaveAttribute('href', '/city')
    expect(screen.getByRole('link', { name: /作品 1/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /城市 1/ })).toBeInTheDocument()
  })

  it('两列都为空时整段不渲染', () => {
    const { container } = render(<HomeBrowse locale="zh" anime={[]} cities={[]} />)
    expect(container.firstChild).toBeNull()
  })
})
