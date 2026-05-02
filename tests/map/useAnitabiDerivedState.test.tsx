import { beforeAll, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

beforeAll(() => {
  if (typeof window === 'undefined') return
  if (typeof window.URL.createObjectURL === 'function') return
  Object.defineProperty(window.URL, 'createObjectURL', {
    value: vi.fn(() => 'blob:maplibre-worker'),
    configurable: true,
  })
})

describe('useAnitabiDerivedState selectedPointImage', () => {
  it('splits inline and preview urls for point detail images', async () => {
    const { useAnitabiDerivedState } = await import('@/features/map/anitabi/useAnitabiDerivedState')
    const { result } = renderHook(() =>
      useAnitabiDerivedState({
        detail: {
          card: {},
          points: [
            {
              id: '217249:db2c913d',
              image: 'https://image.anitabi.cn/points/217249/db2c913d_1754363336601.jpg?plan=h160',
              originUrl: 'https://www.google.com/maps/d/viewer?mid=test',
              geo: [35.7022, 139.752],
            },
          ],
        },
        selectedPointId: '217249:db2c913d',
        detailCardMode: 'point',
        meState: null,
        userLocation: null,
        viewFilter: 'all',
        stateFilter: [],
      })
    )

    expect(result.current.selectedPointImage).toMatchObject({
      inlineUrl: 'http://localhost:3000/api/anitabi/image-render?url=https%3A%2F%2Fimage.anitabi.cn%2Fpoints%2F217249%2Fdb2c913d_1754363336601.jpg%3Fplan%3Dh160',
      previewUrl: 'https://image.anitabi.cn/points/217249/db2c913d_1754363336601.jpg?w=640&q=80',
      downloadUrl: 'https://image.anitabi.cn/points/217249/db2c913d_1754363336601.jpg',
    })
  })
})
