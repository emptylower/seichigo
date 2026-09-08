import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import QRCode from 'qrcode'
import PointShareCard from '@/components/share/PointShareCard'

vi.mock('qrcode', () => ({
  default: { toDataURL: vi.fn(async () => 'data:image/png;base64,qr') },
}))

const candidatesMock = vi.fn<(src: string, options?: { kind?: string }) => string[]>()
vi.mock('@/lib/anitabi/imageProxy', () => ({
  getMapDisplayImageCandidates: (...args: any[]) => candidatesMock(...args),
}))

const drawLocatorSpy = vi.fn()
vi.mock('@/components/share/japanLocator', () => ({
  drawJapanLocator: (...args: any[]) => drawLocatorSpy(...args),
}))

const blobSizes: number[] = []
const failingSrcs = new Set<string>()
const drawImageSpy = vi.fn()
const fillTextCalls: Array<[string, number, number]> = []

function stubCanvas() {
  const ctx = new Proxy(
    {
      measureText: (text: string) => ({ width: text.length * 10 }),
      createLinearGradient: () => ({ addColorStop: () => undefined }),
      drawImage: drawImageSpy,
      fillText: (text: string, x: number, y: number) => {
        fillTextCalls.push([text, x, y])
      },
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
  failingSrcs.clear()
  fillTextCalls.length = 0
  drawImageSpy.mockClear()
  drawLocatorSpy.mockClear()
  candidatesMock.mockReset()
  candidatesMock.mockImplementation((src: string) => [src])
  ;(QRCode.toDataURL as ReturnType<typeof vi.fn>).mockClear()
  stubCanvas()
  // 让 new Image() 的 onload 立刻触发；failingSrcs 里的 src 走 onerror
  Object.defineProperty(globalThis.Image.prototype, 'src', {
    configurable: true,
    set(this: HTMLImageElement, value: string) {
      Object.defineProperty(this, '__loadedSrc', { value, configurable: true })
      Object.defineProperty(this, 'width', { value: 1600, configurable: true })
      Object.defineProperty(this, 'height', { value: 900, configurable: true })
      setTimeout(() => {
        if (failingSrcs.has(value)) this.onerror?.(new Event('error'))
        else this.onload?.(new Event('load'))
      }, 0)
    },
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

const INPUT = {
  layout: 'portrait' as const,
  locale: 'zh' as const,
  pointName: '葡萄牛奶',
  animeTitle: '摇曳露营△ 三期',
  episode: '1',
  scene: '1194',
  address: '東京都 武蔵野市 中町一丁目',
  note: '武州屋 x 远林 x 摇曳露营 推出了联名饮品',
  geo: [35.7, 139.56] as [number, number],
  inJapan: true,
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

  it('实拍图加载失败时退回 default 布局，不留空槽', async () => {
    failingSrcs.add('blob:photo')
    const onRendered = vi.fn()
    render(
      <PointShareCard
        input={{ ...INPUT, photoObjectUrl: 'blob:photo' }}
        onRendered={onRendered}
        onError={vi.fn()}
      />,
    )
    await waitFor(() => expect(onRendered).toHaveBeenCalled())
    // drawImage(img, sx, sy, sw, sh, x, y, w, h)：竖版 default 主视觉高 720，compare 只有 360
    const mainDraw = drawImageSpy.mock.calls.find(
      (call) => call[7] === 1080 && (call[8] === 720 || call[8] === 360),
    )
    expect(mainDraw?.[8]).toBe(720)
  })

  it('动画截图走同源代理候选梯：第一候选失败时用第二候选', async () => {
    candidatesMock.mockReturnValue(['https://img.example/fail.jpg', 'https://img.example/ok.jpg'])
    failingSrcs.add('https://img.example/fail.jpg')
    const onRendered = vi.fn()
    render(<PointShareCard input={INPUT} onRendered={onRendered} onError={vi.fn()} />)
    await waitFor(() => expect(onRendered).toHaveBeenCalled())
    expect(candidatesMock).toHaveBeenCalledWith(INPUT.animeImage, { kind: 'point' })
    const mainDraw = drawImageSpy.mock.calls.find((call) => call[7] === 1080 && call[8] === 720)
    expect((mainDraw?.[0] as { __loadedSrc?: string } | undefined)?.__loadedSrc).toBe(
      'https://img.example/ok.jpg',
    )
  })

  it('二维码优先用 qrUrl，缺省退回 shareUrl', async () => {
    const onRendered = vi.fn()
    render(
      <PointShareCard
        input={{ ...INPUT, qrUrl: 'https://seichigo.com/s/AbC12xYz?c=save' }}
        onRendered={onRendered}
        onError={vi.fn()}
      />,
    )
    await waitFor(() => expect(onRendered).toHaveBeenCalled())
    expect(QRCode.toDataURL).toHaveBeenCalledWith(
      'https://seichigo.com/s/AbC12xYz?c=save',
      expect.objectContaining({ margin: 1 }),
    )
  })
})

describe('formatSceneTime', () => {
  it('秒数格式化为 mm:ss，超过一小时带小时', async () => {
    const { formatSceneTime } = await import('@/components/share/PointShareCard')
    expect(formatSceneTime('1194')).toBe('19:54')
    expect(formatSceneTime('65')).toBe('1:05')
    expect(formatSceneTime('3725')).toBe('1:02:05')
    expect(formatSceneTime('第3話 冒頭')).toBe('第3話 冒頭')
  })
})

describe('PointShareCard v2 文字与轮廓', () => {
  const textsOf = () => fillTextCalls.map(([text]) => text)

  it('依次画点位名、作品行、地址行、说明行，最后是页脚', async () => {
    const onRendered = vi.fn()
    render(<PointShareCard input={INPUT} onRendered={onRendered} onError={vi.fn()} />)
    await waitFor(() => expect(onRendered).toHaveBeenCalled())
    const texts = textsOf()
    expect(texts[0]).toBe('葡萄牛奶')
    expect(texts[1]).toBe('《摇曳露营△ 三期》 · 第 1 集 · 19:54')
    expect(texts[2]).toBe('📍 東京都 武蔵野市 中町一丁目')
    expect(texts[3]).toContain('武州屋')
    expect(texts[texts.length - 1]).toBe('⛩ seichigo.com')
  })

  it('文字左边界用 textX（竖版 64）', async () => {
    const onRendered = vi.fn()
    render(<PointShareCard input={INPUT} onRendered={onRendered} onError={vi.fn()} />)
    await waitFor(() => expect(onRendered).toHaveBeenCalled())
    expect(fillTextCalls[0]![1]).toBe(64)
  })

  it('横版文字与页脚都落在右列 692', async () => {
    const onRendered = vi.fn()
    render(
      <PointShareCard input={{ ...INPUT, layout: 'landscape' }} onRendered={onRendered} onError={vi.fn()} />,
    )
    await waitFor(() => expect(onRendered).toHaveBeenCalled())
    expect(fillTextCalls[0]![1]).toBe(692)
    expect(fillTextCalls[fillTextCalls.length - 1]![1]).toBe(692)
  })

  it('没有地址就不画地址行，没有说明就不画说明行', async () => {
    const onRendered = vi.fn()
    render(
      <PointShareCard
        input={{ ...INPUT, address: null, note: null }}
        onRendered={onRendered}
        onError={vi.fn()}
      />,
    )
    await waitFor(() => expect(onRendered).toHaveBeenCalled())
    const texts = textsOf()
    expect(texts.some((text) => text.startsWith('📍'))).toBe(false)
    expect(texts.some((text) => text.includes('武州屋'))).toBe(false)
    expect(texts[0]).toBe('葡萄牛奶')
    expect(texts[1]).toBe('《摇曳露营△ 三期》 · 第 1 集 · 19:54')
  })

  it('三语作品行分别用《》/『』/裸标题', async () => {
    for (const [locale, expected] of [
      ['zh', '《摇曳露营△ 三期》 · 第 1 集 · 19:54'],
      ['ja', '『摇曳露营△ 三期』 · 第1話 · 19:54'],
      ['en', '摇曳露营△ 三期 · EP 1 · 19:54'],
    ] as const) {
      fillTextCalls.length = 0
      const onRendered = vi.fn()
      const { unmount } = render(
        <PointShareCard input={{ ...INPUT, locale }} onRendered={onRendered} onError={vi.fn()} />,
      )
      await waitFor(() => expect(onRendered).toHaveBeenCalled())
      expect(textsOf()[1], locale).toBe(expected)
      unmount()
    }
  })

  it('inJapan 为 true 时按 layout.locator 画轮廓并带定位点', async () => {
    const onRendered = vi.fn()
    render(<PointShareCard input={INPUT} onRendered={onRendered} onError={vi.fn()} />)
    await waitFor(() => expect(onRendered).toHaveBeenCalled())
    expect(drawLocatorSpy).toHaveBeenCalledTimes(1)
    expect(drawLocatorSpy.mock.calls[0]![1]).toEqual({ x: 64, y: 1096, width: 240, height: 240 })
    expect(drawLocatorSpy.mock.calls[0]![2]).toEqual({ lat: 35.7, lng: 139.56 })
  })

  it('inJapan 为 false 时不画轮廓', async () => {
    const onRendered = vi.fn()
    render(
      <PointShareCard input={{ ...INPUT, inJapan: false }} onRendered={onRendered} onError={vi.fn()} />,
    )
    await waitFor(() => expect(onRendered).toHaveBeenCalled())
    expect(drawLocatorSpy).not.toHaveBeenCalled()
  })

  it('inJapan 为 true 但没有坐标时画轮廓不打点', async () => {
    const onRendered = vi.fn()
    render(<PointShareCard input={{ ...INPUT, geo: null }} onRendered={onRendered} onError={vi.fn()} />)
    await waitFor(() => expect(onRendered).toHaveBeenCalled())
    expect(drawLocatorSpy.mock.calls[0]![2]).toBeNull()
  })
})
