import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import PointShareCard from '@/components/share/PointShareCard'

vi.mock('qrcode', () => ({
  default: { toDataURL: vi.fn(async () => 'data:image/png;base64,qr') },
}))

vi.mock('@/lib/anitabi/imageProxy', () => ({
  toCanvasSafeImageUrl: (src: string) => src,
}))

const blobSizes: number[] = []

function stubCanvas() {
  const ctx = new Proxy(
    {
      measureText: (text: string) => ({ width: text.length * 10 }),
      createLinearGradient: () => ({ addColorStop: () => undefined }),
    } as Record<string, unknown>,
    {
      get(target, prop) {
        if (prop in target) return target[prop as string]
        return () => undefined
      },
      set() {
        return true
      },
    },
  )
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never)
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
    this: HTMLCanvasElement,
    callback: BlobCallback,
    _type?: string,
    quality?: number,
  ) {
    const size = blobSizes.shift() ?? 100
    const blob = new Blob([new Uint8Array(1)], { type: 'image/jpeg' })
    Object.defineProperty(blob, 'size', { value: size })
    Object.defineProperty(blob, 'quality', { value: quality })
    callback(blob)
  })
}

beforeEach(() => {
  blobSizes.length = 0
  stubCanvas()
  // 让 new Image() 的 onload 立刻触发
  Object.defineProperty(globalThis.Image.prototype, 'src', {
    configurable: true,
    set(this: HTMLImageElement) {
      Object.defineProperty(this, 'width', { value: 1600, configurable: true })
      Object.defineProperty(this, 'height', { value: 900, configurable: true })
      setTimeout(() => this.onload?.(new Event('load')), 0)
    },
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

const INPUT = {
  layout: 'portrait' as const,
  locale: 'zh' as const,
  pointName: '须贺神社',
  animeTitle: '你的名字。',
  cityName: '东京',
  episode: '1',
  scene: null,
  animeImage: 'https://image.anitabi.cn/points/101/suga.jpg',
  photoObjectUrl: null,
  shareUrl: 'https://seichigo.com/s/AbC12xYz',
}

describe('PointShareCard', () => {
  it('按版式设置画布尺寸并回调 Blob', async () => {
    const onRendered = vi.fn()
    const { container } = render(<PointShareCard input={INPUT} onRendered={onRendered} onError={vi.fn()} />)
    await waitFor(() => expect(onRendered).toHaveBeenCalled())
    const canvas = container.querySelector('canvas')!
    expect(canvas.width).toBe(1080)
    expect(canvas.height).toBe(1440)
  })

  it('横版走 1200x630', async () => {
    const onRendered = vi.fn()
    const { container } = render(
      <PointShareCard input={{ ...INPUT, layout: 'landscape' }} onRendered={onRendered} onError={vi.fn()} />,
    )
    await waitFor(() => expect(onRendered).toHaveBeenCalled())
    const canvas = container.querySelector('canvas')!
    expect(canvas.width).toBe(1200)
    expect(canvas.height).toBe(630)
  })

  it('首次超过 1.5 MB 时降质量重试一次', async () => {
    blobSizes.push(2_000_000, 900_000)
    const onRendered = vi.fn()
    render(<PointShareCard input={INPUT} onRendered={onRendered} onError={vi.fn()} />)
    await waitFor(() => expect(onRendered).toHaveBeenCalled())
    expect(HTMLCanvasElement.prototype.toBlob).toHaveBeenCalledTimes(2)
    expect(onRendered.mock.calls[0]![0].size).toBe(900_000)
  })
})
