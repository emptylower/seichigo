import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import QRCode from 'qrcode'
import PointShareCard from '@/components/share/PointShareCard'
import { CARD_ROW_METRICS, addressPinMetrics } from '@/components/share/pointShareCardDraw'

vi.mock('qrcode', () => ({
  default: { toDataURL: vi.fn(async () => 'data:image/png;base64,qr') },
}))

const candidatesMock = vi.fn<(src: string, options?: { kind?: string }) => string[]>()
vi.mock('@/lib/anitabi/imageProxy', () => ({
  getMapDisplayImageCandidates: (...args: any[]) => candidatesMock(...args),
}))

const drawLocatorSpy = vi.fn()
const loadOutlineSpy = vi.fn()
const FAKE_OUTLINE = { bbox: [0, 0, 10, 10], rings: [[[0, 0], [10, 0], [10, 10]]] }
vi.mock('@/components/share/japanLocator', () => ({
  drawJapanLocator: (...args: any[]) => drawLocatorSpy(...args),
  loadJapanOutline: (...args: any[]) => loadOutlineSpy(...args),
}))

const blobSizes: number[] = []
const failingSrcs = new Set<string>()
const drawImageSpy = vi.fn()
const fillTextCalls: Array<[string, number, number, string]> = []
const fillStyles: string[] = []
const strokeStyles: string[] = []
const arcCalls: Array<[number, number, number]> = []

function stubCanvas() {
  const target: Record<string, unknown> = {
    measureText: (text: string) => ({ width: text.length * 10 }),
    createLinearGradient: () => ({ addColorStop: () => undefined }),
    drawImage: drawImageSpy,
    fillText: (text: string, x: number, y: number) => {
      fillTextCalls.push([text, x, y, String(target.__font ?? '')])
    },
    arc: (x: number, y: number, r: number) => {
      arcCalls.push([x, y, r])
    },
  }
  const ctx = new Proxy(target, {
    get(t, prop) {
      if (prop in t) return t[prop as string]
      return () => undefined
    },
    set(t, prop, value) {
      if (prop === 'fillStyle') fillStyles.push(String(value))
      if (prop === 'strokeStyle') strokeStyles.push(String(value))
      if (prop === 'font') t.__font = String(value)
      return true
    },
  })
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
  fillStyles.length = 0
  strokeStyles.length = 0
  arcCalls.length = 0
  drawImageSpy.mockClear()
  drawLocatorSpy.mockClear()
  loadOutlineSpy.mockReset()
  loadOutlineSpy.mockResolvedValue(FAKE_OUTLINE)
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
  // v2.1 导航胶囊三语文案由 Panel 通过 t() 注入，测试直接给中文定稿
  cardText: {
    qrTitle: '扫码获取点位导航',
    qrSub: '地图 · 交通 · 周边点位',
    tagline: '5 万+ 动画取景地 · AI 巡礼行程',
  },
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
    // drawImage(img, sx, sy, sw, sh, x, y, w, h)：竖版 default 主视觉高 640，compare 只有 320
    const mainDraw = drawImageSpy.mock.calls.find(
      (call) => call[7] === 1080 && (call[8] === 640 || call[8] === 320),
    )
    expect(mainDraw?.[8]).toBe(640)
  })

  it('动画截图走同源代理候选梯：第一候选失败时用第二候选', async () => {
    candidatesMock.mockReturnValue(['https://img.example/fail.jpg', 'https://img.example/ok.jpg'])
    failingSrcs.add('https://img.example/fail.jpg')
    const onRendered = vi.fn()
    render(<PointShareCard input={INPUT} onRendered={onRendered} onError={vi.fn()} />)
    await waitFor(() => expect(onRendered).toHaveBeenCalled())
    expect(candidatesMock).toHaveBeenCalledWith(INPUT.animeImage, { kind: 'point' })
    const mainDraw = drawImageSpy.mock.calls.find((call) => call[7] === 1080 && call[8] === 640)
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
    // 图钉改成矢量绘制，地址行不再带 📍 字符
    expect(texts[2]).toBe('東京都 武蔵野市 中町一丁目')
    expect(texts[3]).toContain('武州屋')
    expect(texts).toContain('⛩ seichigo.com')
  })

  it('地址行左侧画品牌粉图钉，文字起点右移一个图钉宽', async () => {
    const onRendered = vi.fn()
    render(<PointShareCard input={INPUT} onRendered={onRendered} onError={vi.fn()} />)
    await waitFor(() => expect(onRendered).toHaveBeenCalled())
    const offset = addressPinMetrics(CARD_ROW_METRICS.portrait.address.size).offset
    const addressCall = fillTextCalls.find(([text]) => text === '東京都 武蔵野市 中町一丁目')!
    expect(addressCall[1]).toBe(64 + offset)
    // 图钉是圆头 + 三角，圆头落在文字行左侧、地址行的 y 附近
    expect(fillStyles).toContain('#ec4899')
    const head = arcCalls.find(([x]) => x > 64 && x < 64 + offset)
    expect(head).toBeDefined()
    expect(head![1]).toBeGreaterThanOrEqual(addressCall[2])
  })

  it('没有地址时不画图钉', async () => {
    const onRendered = vi.fn()
    render(
      <PointShareCard input={{ ...INPUT, address: null }} onRendered={onRendered} onError={vi.fn()} />,
    )
    await waitFor(() => expect(onRendered).toHaveBeenCalled())
    // 图钉是唯一填充绘制的 #ec4899；胶囊 GPS 十字圆标是描边 strokeStyle，不走 fillStyle
    expect(fillStyles).not.toContain('#ec4899')
  })

  it('文字左边界用 textX（竖版 64）', async () => {
    const onRendered = vi.fn()
    render(<PointShareCard input={INPUT} onRendered={onRendered} onError={vi.fn()} />)
    await waitFor(() => expect(onRendered).toHaveBeenCalled())
    expect(fillTextCalls[0]![1]).toBe(64)
  })

  it('横版文字与页脚都落在右列 672', async () => {
    const onRendered = vi.fn()
    render(
      <PointShareCard input={{ ...INPUT, layout: 'landscape' }} onRendered={onRendered} onError={vi.fn()} />,
    )
    await waitFor(() => expect(onRendered).toHaveBeenCalled())
    expect(fillTextCalls[0]![1]).toBe(672)
    // 页脚 ⛩ seichigo.com 的 x（v2.1 起 tagline 可能跟在页脚右侧，只查站点名）
    const footerCall = fillTextCalls.find(([text]) => text === '⛩ seichigo.com')!
    expect(footerCall[1]).toBe(672)
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
    expect(texts.some((text) => text.includes('📍'))).toBe(false)
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
    // v2.1：轮廓收进导航胶囊左侧 180×180
    expect(drawLocatorSpy.mock.calls[0]![1]).toEqual({ x: 92, y: 1140, width: 180, height: 180 })
    expect(drawLocatorSpy.mock.calls[0]![2]).toEqual({ lat: 35.7, lng: 139.56 })
    // 轮廓 JSON 懒加载，画的时候把加载结果传进去
    expect(loadOutlineSpy).toHaveBeenCalledTimes(1)
    expect(drawLocatorSpy.mock.calls[0]![3]).toBe(FAKE_OUTLINE)
  })

  it('轮廓 JSON 加载失败时不画轮廓，卡片照常出图', async () => {
    loadOutlineSpy.mockRejectedValue(new Error('chunk load failed'))
    const onRendered = vi.fn()
    render(<PointShareCard input={INPUT} onRendered={onRendered} onError={vi.fn()} />)
    await waitFor(() => expect(onRendered).toHaveBeenCalled())
    expect(drawLocatorSpy).not.toHaveBeenCalled()
  })

  it('inJapan 为 false 时不画轮廓', async () => {
    const onRendered = vi.fn()
    render(
      <PointShareCard input={{ ...INPUT, inJapan: false }} onRendered={onRendered} onError={vi.fn()} />,
    )
    await waitFor(() => expect(onRendered).toHaveBeenCalled())
    expect(drawLocatorSpy).not.toHaveBeenCalled()
    // 海外点位连轮廓 JSON 都不用下
    expect(loadOutlineSpy).not.toHaveBeenCalled()
  })

  it('inJapan 为 true 但没有坐标时画轮廓不打点', async () => {
    const onRendered = vi.fn()
    render(<PointShareCard input={{ ...INPUT, geo: null }} onRendered={onRendered} onError={vi.fn()} />)
    await waitFor(() => expect(onRendered).toHaveBeenCalled())
    expect(drawLocatorSpy.mock.calls[0]![2]).toBeNull()
  })
})

describe('PointShareCard v2.1 导航胶囊', () => {
  const textsOf = () => fillTextCalls.map(([text]) => text)

  it('画胶囊底 #fdf2f8 与粉边 #fbcfe8', async () => {
    const onRendered = vi.fn()
    render(<PointShareCard input={INPUT} onRendered={onRendered} onError={vi.fn()} />)
    await waitFor(() => expect(onRendered).toHaveBeenCalled())
    expect(fillStyles).toContain('#fdf2f8')
    expect(strokeStyles).toContain('#fbcfe8')
  })

  it('二维码画进白卡内缩位：竖版 180 白卡内缩 6，图 168', async () => {
    const onRendered = vi.fn()
    render(<PointShareCard input={INPUT} onRendered={onRendered} onError={vi.fn()} />)
    await waitFor(() => expect(onRendered).toHaveBeenCalled())
    // 竖版 qr 白卡 {808,1140,180}，内缩 6 后图在 (814,1146) 168×168
    const qrDraw = drawImageSpy.mock.calls.find(
      (call) => call.length === 5 && call[3] === 168 && call[4] === 168,
    )
    expect(qrDraw).toBeDefined()
    expect(qrDraw![1]).toBe(814)
    expect(qrDraw![2]).toBe(1146)
  })

  it('中列依次画胶囊标题、等宽坐标行、副标题', async () => {
    const onRendered = vi.fn()
    render(<PointShareCard input={INPUT} onRendered={onRendered} onError={vi.fn()} />)
    await waitFor(() => expect(onRendered).toHaveBeenCalled())
    const texts = textsOf()
    const titleIdx = texts.indexOf('扫码获取点位导航')
    const coordIdx = texts.indexOf('35.7000, 139.5600')
    const subIdx = texts.indexOf('地图 · 交通 · 周边点位')
    expect(titleIdx).toBeGreaterThanOrEqual(0)
    expect(coordIdx).toBeGreaterThan(titleIdx)
    expect(subIdx).toBeGreaterThan(coordIdx)
    // 坐标行用等宽字体
    expect(fillTextCalls[coordIdx]![3]).toContain('ui-monospace')
    // 竖版中列 x：轮廓右缘 92+180 + 间距 24 = 296；坐标文字右移 GPS 图标 offset
    expect(fillTextCalls[titleIdx]![1]).toBe(296)
    expect(fillTextCalls[coordIdx]![1]).toBeCloseTo(296 + 28 * 1.3, 6)
    // 胶囊标题用品牌粉 #be185d
    expect(fillStyles).toContain('#be185d')
  })

  it('geo 为 null 时不画坐标行，标题与副标题照画', async () => {
    const onRendered = vi.fn()
    render(<PointShareCard input={{ ...INPUT, geo: null }} onRendered={onRendered} onError={vi.fn()} />)
    await waitFor(() => expect(onRendered).toHaveBeenCalled())
    const texts = textsOf()
    expect(texts.some((text) => /^\d+\.\d{4}, /.test(text))).toBe(false)
    expect(texts).toContain('扫码获取点位导航')
    expect(texts).toContain('地图 · 交通 · 周边点位')
  })

  it('inJapan 为 false 时中列贴胶囊左缘（64+28=92）', async () => {
    const onRendered = vi.fn()
    render(
      <PointShareCard input={{ ...INPUT, inJapan: false }} onRendered={onRendered} onError={vi.fn()} />,
    )
    await waitFor(() => expect(onRendered).toHaveBeenCalled())
    const titleCall = fillTextCalls.find(([text]) => text === '扫码获取点位导航')!
    expect(titleCall[1]).toBe(92)
  })

  it('横版中列从轮廓右缘 802 起，坐标行 19px 等宽', async () => {
    const onRendered = vi.fn()
    render(
      <PointShareCard input={{ ...INPUT, layout: 'landscape' }} onRendered={onRendered} onError={vi.fn()} />,
    )
    await waitFor(() => expect(onRendered).toHaveBeenCalled())
    const titleCall = fillTextCalls.find(([text]) => text === '扫码获取点位导航')!
    expect(titleCall[1]).toBe(802)
    const coordCall = fillTextCalls.find(([text]) => text === '35.7000, 139.5600')!
    expect(coordCall[3]).toContain('19px ui-monospace')
    // 横版二维码：100 白卡内缩 4，图 92
    const qrDraw = drawImageSpy.mock.calls.find(
      (call) => call.length === 5 && call[3] === 92 && call[4] === 92,
    )
    expect(qrDraw).toBeDefined()
  })
})

describe('PointShareCard v2.1 页脚', () => {
  const textsOf = () => fillTextCalls.map(([text]) => text)

  it('左侧站点名 #64748b，右侧 tagline #94a3b8 右对齐贴 footerRightX', async () => {
    const onRendered = vi.fn()
    render(<PointShareCard input={INPUT} onRendered={onRendered} onError={vi.fn()} />)
    await waitFor(() => expect(onRendered).toHaveBeenCalled())
    const siteCall = fillTextCalls.find(([text]) => text === '⛩ seichigo.com')!
    expect(siteCall[1]).toBe(64)
    expect(siteCall[2]).toBe(1398)
    const taglineCall = fillTextCalls.find(([text]) => text === '5 万+ 动画取景地 · AI 巡礼行程')!
    expect(taglineCall[1]).toBe(1016)
    expect(fillStyles).toContain('#64748b')
    expect(fillStyles).toContain('#94a3b8')
  })

  it('横版 tagline 右对齐贴 1164', async () => {
    const onRendered = vi.fn()
    render(
      <PointShareCard input={{ ...INPUT, layout: 'landscape' }} onRendered={onRendered} onError={vi.fn()} />,
    )
    await waitFor(() => expect(onRendered).toHaveBeenCalled())
    const taglineCall = fillTextCalls.find(([text]) => text === '5 万+ 动画取景地 · AI 巡礼行程')!
    expect(taglineCall[1]).toBe(1164)
  })

  it('tagline 太长、与站点名挤不下时省略右侧', async () => {
    const onRendered = vi.fn()
    render(
      <PointShareCard
        input={{ ...INPUT, cardText: { ...INPUT.cardText, tagline: '长'.repeat(100) } }}
        onRendered={onRendered}
        onError={vi.fn()}
      />,
    )
    await waitFor(() => expect(onRendered).toHaveBeenCalled())
    expect(textsOf()).not.toContain('长'.repeat(100))
    expect(textsOf()).toContain('⛩ seichigo.com')
  })

  it('v2.1 起不再加载与绘制 /brand/web-logo.png', async () => {
    const onRendered = vi.fn()
    render(<PointShareCard input={INPUT} onRendered={onRendered} onError={vi.fn()} />)
    await waitFor(() => expect(onRendered).toHaveBeenCalled())
    const drawnSrcs = drawImageSpy.mock.calls.map(
      (call) => (call[0] as { __loadedSrc?: string }).__loadedSrc,
    )
    expect(drawnSrcs).not.toContain('/brand/web-logo.png')
  })
})

// 2026-09-08 v2.1 P1：横版说明行按 textWidth-8 断行，孤字并入上一行
describe('PointShareCard v2.1 P1 孤字断行', () => {
  it('横版 49 字说明在 484 内收尾：只画一行且以 … 收尾，尾字不越界', async () => {
    // 桩测量 10px/字：横版说明可用宽 492-8=484 → 单行最多 48 字；
    // 49 字时第 49 字成孤字，并入上一行后以 … 收尾
    const note49 = '说'.repeat(49)
    const onRendered = vi.fn()
    render(
      <PointShareCard
        input={{ ...INPUT, layout: 'landscape', note: note49 }}
        onRendered={onRendered}
        onError={vi.fn()}
      />,
    )
    await waitFor(() => expect(onRendered).toHaveBeenCalled())
    const noteCalls = fillTextCalls.filter(([text]) => text.includes('说'))
    expect(noteCalls).toHaveLength(1)
    expect(noteCalls[0]![0]).toMatch(/…$/)
    expect(noteCalls[0]![0].length * 10).toBeLessThanOrEqual(484)
  })

  it('竖版说明行不留 8px 余量：95 字说明仍按 952 断行不带省略号', async () => {
    // 竖版 textWidth 952，桩测量下单行 95 字正好放得下，不触发省略
    const note95 = '说'.repeat(95)
    const onRendered = vi.fn()
    render(
      <PointShareCard input={{ ...INPUT, note: note95 }} onRendered={onRendered} onError={vi.fn()} />,
    )
    await waitFor(() => expect(onRendered).toHaveBeenCalled())
    const noteCalls = fillTextCalls.filter(([text]) => text.includes('说'))
    expect(noteCalls).toHaveLength(1)
    expect(noteCalls[0]![0]).toBe(note95)
  })
})
