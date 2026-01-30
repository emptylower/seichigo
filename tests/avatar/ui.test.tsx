import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import Avatar from '@/components/shared/Avatar'

vi.mock('next/image', () => ({
  default: ({ src, alt, onError, fill, ...props }: any) => {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={src}
        alt={alt}
        onError={onError}
        data-fill={fill ? "true" : undefined}
        {...props}
      />
    )
  },
}))

describe('Avatar Component', () => {
  it('renders image when src is provided', () => {
    render(<Avatar src="/avatar.jpg" name="Test User" />)
    
    const container = screen.getByLabelText('Test User')
    const innerImg = container.querySelector('img')
    
    expect(innerImg).toBeInTheDocument()
    expect(innerImg).toHaveAttribute('src', '/avatar.jpg')
  })

  it('renders initials and gradient when src is missing', () => {
    render(<Avatar name="Test User" />)
    const container = screen.getByLabelText('Test User')
    
    const innerImg = container.querySelector('img')
    expect(innerImg).not.toBeInTheDocument()
    
    expect(container).toHaveTextContent('T')
    expect(container.innerHTML).toContain('linear-gradient')
  })

  it('renders initials and gradient when image fails to load', () => {
    render(<Avatar src="/broken.jpg" name="Test User" />)
    const container = screen.getByLabelText('Test User')
    
    let innerImg = container.querySelector('img')
    expect(innerImg).toBeInTheDocument()
    
    fireEvent.error(innerImg!)
    
    innerImg = container.querySelector('img')
    expect(innerImg).not.toBeInTheDocument()
    expect(container).toHaveTextContent('T')
  })

  it('applies custom size', () => {
    const size = 64
    render(<Avatar name="Test User" size={size} />)
    const container = screen.getByLabelText('Test User')
    expect(container).toHaveStyle({ width: '64px', height: '64px' })
  })
})
