import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import AnimeCard from '@/components/anime/AnimeCard'

const baseAnime = {
  id: 'anime-1',
  name: '中文作品名',
  name_en: 'English Title',
  name_ja: '日本語タイトル',
  summary: '中文简介',
}

describe('AnimeCard locale-aware display name', () => {
  it('uses the English database name on the English index', () => {
    render(<AnimeCard anime={baseAnime} postCount={1} cover={null} locale="en" />)
    expect(screen.getByRole('heading', { name: 'English Title' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '中文作品名' })).not.toBeInTheDocument()
  })

  it('uses the Japanese database name on the Japanese index', () => {
    render(<AnimeCard anime={baseAnime} postCount={1} cover={null} locale="ja" />)
    expect(screen.getByRole('heading', { name: '日本語タイトル' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '中文作品名' })).not.toBeInTheDocument()
  })

  it('falls back to the source name when the locale field is missing', () => {
    const { name_en: _nameEn, ...animeWithoutEnglishName } = baseAnime
    render(<AnimeCard anime={animeWithoutEnglishName} postCount={1} cover={null} locale="en" />)
    expect(screen.getByRole('heading', { name: '中文作品名' })).toBeInTheDocument()
  })
})
