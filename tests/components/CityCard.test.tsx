import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import CityCard from '@/components/city/CityCard'

describe('CityCard locale-aware description', () => {
  const baseCity = {
    id: 'city-1',
    slug: 'tokyo',
    name_zh: '东京',
    name_en: 'Tokyo',
    name_ja: '東京',
    description_zh: '日本首都，现代与传统交融。',
    description_en: 'Capital of Japan, blending modernity and tradition.',
    description_ja: '日本の首都、現代と伝統が融合する街。',
    cover: null,
  }

  describe('locale=en', () => {
    it('renders description_en when provided', () => {
      render(<CityCard city={baseCity} postCount={5} locale="en" />)
      expect(screen.getByText('Capital of Japan, blending modernity and tradition.')).toBeInTheDocument()
    })

    it('falls back to description_zh when description_en is missing', () => {
      const city = { ...baseCity, description_en: null }
      render(<CityCard city={city} postCount={5} locale="en" />)
      expect(screen.getByText('日本首都，现代与传统交融。')).toBeInTheDocument()
    })

    it('renders "—" when both description_en and description_zh are missing', () => {
      const city = { ...baseCity, description_en: null, description_zh: null }
      render(<CityCard city={city} postCount={5} locale="en" />)
      expect(screen.getByText('—')).toBeInTheDocument()
    })
  })

  describe('locale=ja', () => {
    it('renders description_ja when provided', () => {
      render(<CityCard city={baseCity} postCount={5} locale="ja" />)
      expect(screen.getByText('日本の首都、現代と伝統が融合する街。')).toBeInTheDocument()
    })

    it('falls back to description_zh when description_ja is missing', () => {
      const city = { ...baseCity, description_ja: null }
      render(<CityCard city={city} postCount={5} locale="ja" />)
      expect(screen.getByText('日本首都，现代与传统交融。')).toBeInTheDocument()
    })

    it('falls back to description_en when both description_ja and description_zh are missing', () => {
      const city = { ...baseCity, description_ja: null, description_zh: null }
      render(<CityCard city={city} postCount={5} locale="ja" />)
      expect(screen.getByText('Capital of Japan, blending modernity and tradition.')).toBeInTheDocument()
    })

    it('renders "—" when all descriptions are missing', () => {
      const city = { ...baseCity, description_ja: null, description_zh: null, description_en: null }
      render(<CityCard city={city} postCount={5} locale="ja" />)
      expect(screen.getByText('—')).toBeInTheDocument()
    })
  })

  describe('locale=zh', () => {
    it('renders description_zh when provided', () => {
      render(<CityCard city={baseCity} postCount={5} locale="zh" />)
      expect(screen.getByText('日本首都，现代与传统交融。')).toBeInTheDocument()
    })

    it('renders "—" when description_zh is missing', () => {
      const city = { ...baseCity, description_zh: null }
      render(<CityCard city={city} postCount={5} locale="zh" />)
      expect(screen.getByText('—')).toBeInTheDocument()
    })
  })

  describe('name rendering', () => {
    it('renders name_en for locale=en', () => {
      render(<CityCard city={baseCity} postCount={5} locale="en" />)
      expect(screen.getByRole('heading', { name: 'Tokyo' })).toBeInTheDocument()
    })

    it('renders name_ja for locale=ja', () => {
      render(<CityCard city={baseCity} postCount={5} locale="ja" />)
      expect(screen.getByRole('heading', { name: '東京' })).toBeInTheDocument()
    })

    it('renders name_zh for locale=zh', () => {
      render(<CityCard city={baseCity} postCount={5} locale="zh" />)
      expect(screen.getByRole('heading', { name: '东京' })).toBeInTheDocument()
    })
  })
})
