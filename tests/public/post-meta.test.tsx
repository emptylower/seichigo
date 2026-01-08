import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

import PostMeta from '@/components/blog/PostMeta'

describe('PostMeta', () => {
  it('renders anime links', () => {
    render(<PostMeta anime={[{ id: 'btr', label: 'Bocchi the Rock!' }]} city="东京" publishDate="2025-01-01" />)

    const link = screen.getByRole('link', { name: 'Bocchi the Rock!' })
    expect(link).toHaveAttribute('href', '/anime/btr')
  })
})

