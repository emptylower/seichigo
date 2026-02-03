import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import CopyLinkButton from '@/components/resources/CopyLinkButton'

describe('CopyLinkButton', () => {
  beforeEach(() => {
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn(() => Promise.resolve()),
      },
    })
  })

  describe('locale-aware labels', () => {
    it('renders Chinese label and "已复制" when copied (locale=zh)', async () => {
      render(<CopyLinkButton path="/test" label="引用" locale="zh" />)
      
      const button = screen.getByRole('button', { name: '引用' })
      expect(button).toHaveTextContent('引用')
      
      fireEvent.click(button)
      
      await waitFor(() => {
        expect(button).toHaveTextContent('已复制')
      })
    })

    it('renders English label and "Copied" when copied (locale=en)', async () => {
      render(<CopyLinkButton path="/test" label="Copy" locale="en" />)
      
      const button = screen.getByRole('button', { name: 'Copy' })
      expect(button).toHaveTextContent('Copy')
      
      fireEvent.click(button)
      
      await waitFor(() => {
        expect(button).toHaveTextContent('Copied')
      })
    })

    it('renders Japanese label and "コピー済み" when copied (locale=ja)', async () => {
      render(<CopyLinkButton path="/test" label="引用" locale="ja" />)
      
      const button = screen.getByRole('button', { name: '引用' })
      expect(button).toHaveTextContent('引用')
      
      fireEvent.click(button)
      
      await waitFor(() => {
        expect(button).toHaveTextContent('コピー済み')
      })
    })
  })

  describe('clipboard functionality', () => {
    it('copies full URL to clipboard when path is relative', async () => {
      const writeTextMock = vi.fn(() => Promise.resolve())
      Object.assign(navigator, {
        clipboard: { writeText: writeTextMock },
      })

      render(<CopyLinkButton path="/resources?route=test" label="Copy" locale="en" />)
      
      const button = screen.getByRole('button')
      fireEvent.click(button)
      
      await waitFor(() => {
        expect(writeTextMock).toHaveBeenCalledWith(
          expect.stringContaining('/resources?route=test')
        )
      })
    })

    it('copies absolute URL as-is', async () => {
      const writeTextMock = vi.fn(() => Promise.resolve())
      Object.assign(navigator, {
        clipboard: { writeText: writeTextMock },
      })

      render(<CopyLinkButton path="https://example.com/test" label="Copy" locale="en" />)
      
      const button = screen.getByRole('button')
      fireEvent.click(button)
      
      await waitFor(() => {
        expect(writeTextMock).toHaveBeenCalledWith('https://example.com/test')
      })
    })
  })

  describe('custom className', () => {
    it('applies custom className when provided', () => {
      render(
        <CopyLinkButton 
          path="/test" 
          label="Copy" 
          locale="en" 
          className="custom-class"
        />
      )
      
      const button = screen.getByRole('button')
      expect(button).toHaveClass('custom-class')
    })

    it('applies default className when not provided', () => {
      render(<CopyLinkButton path="/test" label="Copy" locale="en" />)
      
      const button = screen.getByRole('button')
      expect(button).toHaveClass('inline-flex', 'items-center', 'justify-center')
    })
  })
})
