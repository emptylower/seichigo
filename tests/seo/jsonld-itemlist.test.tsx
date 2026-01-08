import React from 'react'
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import SpotList from '@/components/content/SpotList'

describe('SpotList json-ld', () => {
  it('renders ItemList when spots exist', () => {
    const { container } = render(
      <SpotList
        spots={[
          { order: 1, name: '地点 A', googleMapsUrl: 'https://maps.google.com/?q=a' },
          { order: 2, name: '地点 B', googleMapsUrl: 'https://maps.google.com/?q=b' },
        ]}
      />
    )

    const scripts = Array.from(container.querySelectorAll('script[type="application/ld+json"]'))
    const parsed = scripts
      .map((s) => {
        try {
          return JSON.parse(s.textContent || '')
        } catch {
          return null
        }
      })
      .filter(Boolean) as any[]

    expect(parsed.some((x) => x['@type'] === 'ItemList')).toBe(true)
  })

  it('does not render ItemList when no spots', () => {
    const { container } = render(<SpotList spots={[]} />)
    expect(container.querySelector('script[type="application/ld+json"]')).toBeNull()
  })
})

