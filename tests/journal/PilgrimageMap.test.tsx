import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { PilgrimageMap } from '@/app/(authed)/me/journal/components/PilgrimageMap'

describe('PilgrimageMap', () => {
  it('renders title and stat line', () => {
    const { getByText } = render(
      <PilgrimageMap
        pointsVisited={47}
        prefectures={[
          { nameZh: '神奈川', pointCount: 12 },
          { nameZh: '京都', pointCount: 8 },
        ]}
        pins={[
          { lat: 35.3, lng: 139.5, isMostRecent: true },
          { lat: 34.7, lng: 135.5, isMostRecent: false },
        ]}
      />,
    )
    expect(getByText('我走过的地方')).toBeTruthy()
    expect(getByText(/47.*取景地.*2.*个县市/)).toBeTruthy()
  })

  it('renders one pin per pinsForMap entry', () => {
    const { container } = render(
      <PilgrimageMap
        pointsVisited={2}
        prefectures={[{ nameZh: '神奈川', pointCount: 2 }]}
        pins={[
          { lat: 35.3, lng: 139.5, isMostRecent: true },
          { lat: 34.7, lng: 135.5, isMostRecent: false },
        ]}
      />,
    )
    expect(container.querySelectorAll('[data-pin]').length).toBe(2)
  })

  it('marks the most-recent pin with data-recent attribute', () => {
    const { container } = render(
      <PilgrimageMap
        pointsVisited={1}
        prefectures={[]}
        pins={[{ lat: 35.3, lng: 139.5, isMostRecent: true }]}
      />,
    )
    const pin = container.querySelector('[data-pin]')
    expect(pin?.getAttribute('data-recent')).toBe('true')
  })

  it('renders prefectures as comma-separated labels', () => {
    const { getByText } = render(
      <PilgrimageMap
        pointsVisited={5}
        prefectures={[
          { nameZh: '神奈川', pointCount: 3 },
          { nameZh: '京都', pointCount: 2 },
        ]}
        pins={[]}
      />,
    )
    expect(getByText('神奈川')).toBeTruthy()
    expect(getByText('京都')).toBeTruthy()
  })
})
