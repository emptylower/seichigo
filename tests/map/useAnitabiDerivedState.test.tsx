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
      // E2 双重编码：inline 代理候选的 url 参数比单次编码再多一层；
      // 预览图直连走投递 host（img-tc.anitabi.cn，main 的 df23b4f）。
      inlineUrl: `http://localhost:3000/api/anitabi/image-render?url=${encodeURIComponent(encodeURIComponent('https://image.anitabi.cn/points/217249/db2c913d_1754363336601.jpg?plan=h160'))}`,
      previewUrl: 'https://img-tc.anitabi.cn/points/217249/db2c913d_1754363336601.jpg?w=640&q=80',
      downloadUrl: 'https://image.anitabi.cn/points/217249/db2c913d_1754363336601.jpg',
    })
  })
})
