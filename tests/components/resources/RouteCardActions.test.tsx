import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import RouteCardActions from '@/components/resources/RouteCardActions'

// Mock Next.js Link component
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

describe('RouteCardActions', () => {
  const baseProps = {
    articleHref: '/posts/test-article',
    routeHref: '/resources?route=test',
    primaryHref: 'https://maps.google.com/test',
  }

  describe('locale-aware button labels', () => {
    it('renders Chinese labels (locale=zh)', () => {
      render(<RouteCardActions {...baseProps} locale="zh" />)
      
      expect(screen.getByText('阅读原文')).toBeInTheDocument()
      expect(screen.getByText('引用地图')).toBeInTheDocument()
      expect(screen.getByText('打开地图')).toBeInTheDocument()
    })

    it('renders English labels (locale=en)', () => {
      render(<RouteCardActions {...baseProps} locale="en" />)
      
      expect(screen.getByText('Read Article')).toBeInTheDocument()
      expect(screen.getByText('Quote Map')).toBeInTheDocument()
      expect(screen.getByText('Open Map')).toBeInTheDocument()
    })

    it('renders Japanese labels (locale=ja)', () => {
      render(<RouteCardActions {...baseProps} locale="ja" />)
      
      expect(screen.getByText('記事を読む')).toBeInTheDocument()
      expect(screen.getByText('マップを引用')).toBeInTheDocument()
      expect(screen.getByText('マップを開く')).toBeInTheDocument()
    })
  })

  describe('primaryHref handling', () => {
    it('renders active "Open Map" button when primaryHref is provided', () => {
      render(<RouteCardActions {...baseProps} locale="en" />)
      
      const openMapButton = screen.getByText('Open Map')
      expect(openMapButton.tagName).toBe('A')
      expect(openMapButton).toHaveAttribute('href', baseProps.primaryHref)
      expect(openMapButton).toHaveAttribute('target', '_blank')
      expect(openMapButton).toHaveAttribute('rel', 'noopener noreferrer')
    })

    it('renders disabled "Open Map" button when primaryHref is null', () => {
      render(<RouteCardActions {...baseProps} primaryHref={null} locale="en" />)
      
      const openMapButton = screen.getByText('Open Map')
      expect(openMapButton.tagName).toBe('SPAN')
      expect(openMapButton).toHaveClass('bg-gray-100', 'text-gray-400')
    })
  })

  describe('link hrefs', () => {
    it('links to correct article href', () => {
      render(<RouteCardActions {...baseProps} locale="en" />)
      
      const readButton = screen.getByText('Read Article')
      expect(readButton).toHaveAttribute('href', baseProps.articleHref)
    })
  })

  describe('event propagation', () => {
    it('stops click propagation on container', () => {
      const { container } = render(<RouteCardActions {...baseProps} locale="en" />)
      
      const actionsContainer = container.querySelector('.grid')
      expect(actionsContainer).toBeInTheDocument()
      
      // Verify onClick handler exists (stops propagation)
      const clickEvent = new MouseEvent('click', { bubbles: true })
      const stopPropagationSpy = vi.spyOn(clickEvent, 'stopPropagation')
      
      actionsContainer?.dispatchEvent(clickEvent)
      expect(stopPropagationSpy).toHaveBeenCalled()
    })
  })
})
