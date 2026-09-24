import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { resolvePointDisplayImage, usePointPreviews } from '@/app/(authed)/me/routebooks/[id]/hooks/usePointPreviews'

const RAW = 'https://image.anitabi.cn/user/1111/bangumi/431767/points/l6o9ne7k5-1723389788070.jpg'
const R2 = 'https://img.seichigo.com'

describe('S5 点位图走 R2 公共域（与 /map 同一解析）', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('配置了 R2 公共域：原始 anitabi URL → 以 R2 公共域开头', async () => {
    vi.stubEnv('NEXT_PUBLIC_MAP_IMAGE_R2_PUBLIC_BASE', R2)
    const src = await resolvePointDisplayImage(RAW)
    expect(src.startsWith(`${R2}/`)).toBe(true)
    expect(src.startsWith('https://image.anitabi.cn')).toBe(false)
  })

  it('未配置 R2：退到同源图片代理，不再直连 image.anitabi.cn', async () => {
    vi.stubEnv('NEXT_PUBLIC_MAP_IMAGE_R2_PUBLIC_BASE', '')
    const src = await resolvePointDisplayImage(RAW)
    expect(src.startsWith(`${window.location.origin}/api/anitabi/image-render?`)).toBe(true)
  })

  it('hook 产出的 preview.image 以 R2 公共域开头，imageSource 保留原图（署名用）', async () => {
    vi.stubEnv('NEXT_PUBLIC_MAP_IMAGE_R2_PUBLIC_BASE', R2)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          card: { title: 'Hibike', titleZh: '吹响吧！上低音号' },
          points: [{ id: 'l6o9ne7k5', name: '宇治桥', image: RAW, geo: [34.89, 135.8] }],
        }),
      }))
    )
    const { result } = renderHook(() => usePointPreviews(['431767:l6o9ne7k5'], 'zh'))

    await waitFor(() => expect(result.current.getPointPreview('431767:l6o9ne7k5').title).toBe('宇治桥'))
    const preview = result.current.getPointPreview('431767:l6o9ne7k5')
    expect(preview.image?.startsWith(`${R2}/`)).toBe(true)
    expect(preview.imageSource).toBe(RAW)
  })
})
