import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import PointSharePanel from '@/components/share/PointSharePanel'
import { t } from '@/lib/i18n'

/**
 * 从 bbc175c 捞回的目的地/行为测试：客户端 canvas 卡片已删，
 * 原来对 PointShareCard 桩的断言换成对 fetchCardBlob（动作时按需取 blob）
 * 与预览 <img>（fireEvent.load / fireEvent.error 驱动）的桩，其余断言尽量原样。
 */
const createShareLinkMock = vi.fn()
const fetchCardBlobMock = vi.fn()
const uploadSharePhotoMock = vi.fn()
const transcodeToJpegMock = vi.fn()
const copyImageMock = vi.fn()
const downloadBlobMock = vi.fn()
const fetchPointContextMock = vi.fn()
const shareViaSystemMock = vi.fn()
const copyTextMock = vi.fn()
const openBlankWindowMock = vi.fn()
const openOrNavigateMock = vi.fn()
vi.mock('@/components/share/shareClient', async () => {
  const actual = await vi.importActual<typeof import('@/components/share/shareClient')>(
    '@/components/share/shareClient',
  )
  return {
    ...actual,
    createShareLink: (...args: any[]) => createShareLinkMock(...args),
    fetchCardBlob: (...args: any[]) => fetchCardBlobMock(...args),
    uploadSharePhoto: (...args: any[]) => uploadSharePhotoMock(...args),
    transcodeToJpeg: (...args: any[]) => transcodeToJpegMock(...args),
    copyImage: (...args: any[]) => copyImageMock(...args),
    downloadBlob: (...args: any[]) => downloadBlobMock(...args),
    fetchPointContext: (...args: any[]) => fetchPointContextMock(...args),
    shareViaSystem: (...args: any[]) => shareViaSystemMock(...args),
    copyText: (...args: any[]) => copyTextMock(...args),
    openBlankWindow: (...args: any[]) => openBlankWindowMock(...args),
    openOrNavigate: (...args: any[]) => openOrNavigateMock(...args),
  }
})

const useSessionMock = vi.fn()
vi.mock('next-auth/react', () => ({ useSession: () => useSessionMock() }))

const PROPS = {
  pointId: '101:suga',
  bangumiId: 101,
  pointName: '须贺神社',
  animeTitle: '你的名字。',
  cityName: '东京',
  episode: '1',
  scene: null,
  animeImage: 'https://image.anitabi.cn/points/101/suga.jpg',
  locale: 'zh' as const,
  onClose: vi.fn(),
}

const DEFAULT_CONTEXT = {
  address: '東京都 新宿区 須賀町',
  geo: [35.68, 139.72] as [number, number],
  note: '楼梯在神社南侧',
  inJapan: true,
  displayName: '须贺神社',
  animeTitle: '你的名字。',
}

beforeEach(() => {
  vi.clearAllMocks()
  globalThis.localStorage?.clear()
  // 手机/桌面路径看 navigator.share 是否存在：默认删掉走桌面，手机用例自行补桩
  delete (globalThis.navigator as { share?: unknown }).share
  useSessionMock.mockReturnValue({ data: { user: { name: 'u' } }, status: 'authenticated' })
  createShareLinkMock.mockResolvedValue({ code: 'AbC12xYz', url: 'https://seichigo.com/s/AbC12xYz' })
  // 卡片动作（保存/复制）按需取 blob，桩成立即成功的 WebP
  fetchCardBlobMock.mockResolvedValue(new Blob(['card'], { type: 'image/webp' }))
  fetchPointContextMock.mockResolvedValue(DEFAULT_CONTEXT)
  shareViaSystemMock.mockResolvedValue('shared')
  copyTextMock.mockResolvedValue(true)
  copyImageMock.mockResolvedValue(true)
  transcodeToJpegMock.mockResolvedValue(new Blob([new Uint8Array(1)], { type: 'image/jpeg' }))
  openBlankWindowMock.mockReturnValue({ location: { href: '' } })
  openOrNavigateMock.mockReturnValue(true)
  ;(globalThis.URL as any).createObjectURL ??= vi.fn(() => 'blob:preview')
  ;(globalThis.URL as any).revokeObjectURL ??= vi.fn()
})

/** 让面板走系统分享路径：navigator.share 存在即视为可用 */
function enableSystemShare() {
  Object.defineProperty(globalThis.navigator, 'share', {
    value: vi.fn(async () => undefined),
    configurable: true,
  })
}

/**
 * 渲染并等到「就绪」：预览 <img> fire load + 短链落定后 X 按钮才可点。
 * 需要等文案地址回填的用例再另外 waitFor caption。
 */
async function readyPanel(props = PROPS) {
  render(<PointSharePanel {...props} />)
  fireEvent.load(await screen.findByAltText(t('share.panelTitle', 'zh')))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: t('share.platformX', 'zh') })).not.toBeDisabled(),
  )
}

async function openCaptionEditor() {
  const collapsed = await screen.findByRole('button', { name: t('share.captionLabel', 'zh') })
  fireEvent.click(collapsed)
  return screen.getByLabelText(t('share.captionLabel', 'zh'))
}

describe('PointSharePanel 短链与版式', () => {
  it('打开时就建短链', async () => {
    render(<PointSharePanel {...PROPS} />)
    await waitFor(() => expect(createShareLinkMock).toHaveBeenCalledTimes(1))
    expect(createShareLinkMock).toHaveBeenCalledWith({
      pointId: '101:suga',
      bangumiId: 101,
      locale: 'zh',
      layout: 'portrait',
    })
  })

  it('切到横版会用新版式再建一条短链，并记住选择', async () => {
    await readyPanel()
    fireEvent.click(screen.getByRole('button', { name: t('share.layoutLandscape', 'zh') }))
    await waitFor(() => expect(createShareLinkMock).toHaveBeenCalledTimes(2))
    expect(createShareLinkMock.mock.calls[1]![0].layout).toBe('landscape')
    expect(globalThis.localStorage.getItem('seichigo.share.layout')).toBe('landscape')
  })

  it('当前版式按钮带 aria-pressed=true，另一个为 false', async () => {
    render(<PointSharePanel {...PROPS} />)
    expect(screen.getByRole('button', { name: t('share.layoutPortrait', 'zh') })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('button', { name: t('share.layoutLandscape', 'zh') })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })

  it('挂载后再读 localStorage 里的版式偏好', async () => {
    globalThis.localStorage.setItem('seichigo.share.layout', 'landscape')
    render(<PointSharePanel {...PROPS} />)
    // 初值固定 portrait（避免水合不一致），挂载后读到 landscape 再建一条短链
    await waitFor(() => expect(createShareLinkMock).toHaveBeenCalledTimes(2))
    expect(createShareLinkMock.mock.calls[0]![0].layout).toBe('portrait')
    expect(createShareLinkMock.mock.calls[1]![0].layout).toBe('landscape')
  })

  it('建短链失败时显示失败提示与重试按钮，点击后重新请求', async () => {
    createShareLinkMock.mockResolvedValueOnce(null)
    render(<PointSharePanel {...PROPS} />)
    const retry = await screen.findByRole('button', { name: t('share.retry', 'zh') })
    expect(screen.getByText(t('share.generateFailed', 'zh'))).toBeInTheDocument()
    // 失败态目的地网格禁用可见，不翻回骨架
    expect(screen.queryByTestId('share-destinations-skeleton')).toBeNull()
    expect(await screen.findByRole('button', { name: t('share.platformX', 'zh') })).toBeDisabled()
    fireEvent.click(retry)
    await waitFor(() => expect(createShareLinkMock).toHaveBeenCalledTimes(2))
    // 重试成功且预览图加载后平台链接出现
    fireEvent.load(screen.getByAltText(t('share.panelTitle', 'zh')))
    await screen.findByRole('link', { name: 'Reddit' })
  })
})

describe('PointSharePanel 点位上下文（进文案）', () => {
  it('打开时与建短链并行拉一次 point-context', async () => {
    render(<PointSharePanel {...PROPS} />)
    await waitFor(() => expect(fetchPointContextMock).toHaveBeenCalledTimes(1))
    expect(fetchPointContextMock).toHaveBeenCalledWith('101:suga', 'zh')
  })

  it('文案带城市级地址（前两级，去掉空格）', async () => {
    await readyPanel()
    const textarea = await openCaptionEditor()
    await waitFor(() =>
      expect(textarea).toHaveValue(
        '《你的名字。》圣地巡礼｜须贺神社 · 東京都新宿区 https://seichigo.com/s/AbC12xYz?c=copy #圣地巡礼 #你的名字。',
      ),
    )
  })

  it('没有地址时文案退回 props 的 cityName', async () => {
    fetchPointContextMock.mockResolvedValue({ ...DEFAULT_CONTEXT, address: null })
    await readyPanel()
    const textarea = await openCaptionEditor()
    await waitFor(() =>
      expect(textarea).toHaveValue(
        '《你的名字。》圣地巡礼｜须贺神社 · 东京 https://seichigo.com/s/AbC12xYz?c=copy #圣地巡礼 #你的名字。',
      ),
    )
  })

  it('context 里的 displayName 覆盖 props 的 pointName', async () => {
    fetchPointContextMock.mockResolvedValue({
      address: null,
      geo: null,
      note: null,
      inJapan: false,
      displayName: '葡萄牛奶',
      animeTitle: '摇曳露营△ 三期',
    })
    await readyPanel({ ...PROPS, pointName: '『摇曳露营△ 三期』葡萄牛奶' })
    const textarea = await openCaptionEditor()
    // context.address 为 null，地址退回 props 的 cityName（东京）
    await waitFor(() =>
      expect(textarea).toHaveValue(
        '《摇曳露营△ 三期》圣地巡礼｜葡萄牛奶 · 东京 https://seichigo.com/s/AbC12xYz?c=copy #圣地巡礼 #摇曳露营△三期',
      ),
    )
  })

  it('换版式不重复拉 point-context（跟版式无关）', async () => {
    await readyPanel()
    expect(fetchPointContextMock).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: t('share.layoutLandscape', 'zh') }))
    await waitFor(() => expect(createShareLinkMock).toHaveBeenCalledTimes(2))
    expect(fetchPointContextMock).toHaveBeenCalledTimes(1)
  })
})

describe('PointSharePanel 实拍', () => {
  it('HEIC 等非 JPEG 走转码后上传，成功后卡片 URL 带 photo 参数', async () => {
    uploadSharePhotoMock.mockResolvedValue({
      ok: true,
      imageUrl: null,
      photoUrl: '/api/share/photo/u1/101%3Asuga',
      photoKey: 'checkin/u1/101:suga.jpg',
    })
    const { container } = render(<PointSharePanel {...PROPS} />)
    await waitFor(() => expect(screen.getByText(t('share.addPhoto', 'zh'))).not.toBeDisabled())
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    const heic = new File([new Uint8Array(10)], 'photo.heic', { type: 'image/heic' })
    fireEvent.change(input, { target: { files: [heic] } })
    await waitFor(() => expect(transcodeToJpegMock).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(uploadSharePhotoMock).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(screen.getByAltText(t('share.panelTitle', 'zh'))).toHaveAttribute(
        'src',
        expect.stringContaining('photo=checkin%2Fu1%2F101%3Asuga.jpg'),
      ),
    )
  })

  it('转码失败提示不支持并清空选择', async () => {
    transcodeToJpegMock.mockResolvedValue(null)
    const { container } = render(<PointSharePanel {...PROPS} />)
    await waitFor(() => expect(screen.getByText(t('share.addPhoto', 'zh'))).not.toBeDisabled())
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    const gif = new File([new Uint8Array(10)], 'dance.gif', { type: 'image/gif' })
    fireEvent.change(input, { target: { files: [gif] } })
    expect(await screen.findByRole('status')).toHaveTextContent(
      t('share.toastPhotoUnsupported', 'zh'),
    )
    expect(screen.getByRole('button', { name: t('share.addPhoto', 'zh') })).toBeInTheDocument()
  })

  it('复制图片不可用时降级为下载并提示已保存', async () => {
    copyImageMock.mockResolvedValue(false)
    await readyPanel()
    fireEvent.click(screen.getByRole('button', { name: t('share.more', 'zh') }))
    const copyBtn = screen.getByRole('button', { name: t('share.copyImage', 'zh') })
    expect(copyBtn).not.toBeDisabled()
    fireEvent.click(copyBtn)
    await waitFor(() => expect(downloadBlobMock).toHaveBeenCalledTimes(1))
    expect(downloadBlobMock.mock.calls[0]![1]).toBe('seichigo-须贺神社.webp')
    expect(await screen.findByRole('status')).toHaveTextContent(t('share.toastSaved', 'zh'))
  })
})

describe('PointSharePanel 桌面路径', () => {
  it('不显示「分享到…」主按钮', async () => {
    await readyPanel()
    expect(screen.queryByRole('button', { name: t('share.shareTo', 'zh') })).not.toBeInTheDocument()
  })

  it('桌面六个入口仍是三列', async () => {
    await readyPanel()
    expect(screen.getByTestId('share-destinations').className).toContain('grid-cols-3')
  })

  it('X：先同步开窗口，再写剪贴板，最后设 location', async () => {
    await readyPanel()
    fireEvent.click(screen.getByRole('button', { name: t('share.platformX', 'zh') }))
    await waitFor(() => expect(openOrNavigateMock).toHaveBeenCalledTimes(1))
    // 同步链路：window.open 必须发生在 await 剪贴板之前
    expect(openBlankWindowMock.mock.invocationCallOrder[0]!).toBeLessThan(
      copyImageMock.mock.invocationCallOrder[0]!,
    )
    expect(openOrNavigateMock.mock.calls[0]![1]).toContain('https://twitter.com/intent/tweet?text=')
    expect(decodeURIComponent(String(openOrNavigateMock.mock.calls[0]![1]))).toContain(
      'https://seichigo.com/s/AbC12xYz?c=x',
    )
    expect(await screen.findByRole('status')).toHaveTextContent(
      t('share.toastImageCopiedPasteInPost', 'zh'),
    )
  })

  it('X：剪贴板写图失败改为下载并换提示', async () => {
    copyImageMock.mockResolvedValue(false)
    await readyPanel()
    fireEvent.click(screen.getByRole('button', { name: t('share.platformX', 'zh') }))
    await waitFor(() => expect(downloadBlobMock).toHaveBeenCalledTimes(1))
    expect(await screen.findByRole('status')).toHaveTextContent(
      t('share.toastImageDownloadedDragIntoPost', 'zh'),
    )
  })

  it('X：窗口被彻底拦截时改为复制文案并提示打开 X', async () => {
    openBlankWindowMock.mockReturnValue(null)
    openOrNavigateMock.mockReturnValue(false)
    await readyPanel()
    fireEvent.click(screen.getByRole('button', { name: t('share.platformX', 'zh') }))
    await waitFor(() => expect(copyTextMock).toHaveBeenCalledTimes(1))
    expect(String(copyTextMock.mock.calls[0]![0])).toContain('?c=x')
    expect(await screen.findByRole('status')).toHaveTextContent(
      t('share.toastSavedAndCopiedOpenApp', 'zh').replace('{app}', t('share.platformX', 'zh')),
    )
  })

  it('X：窗口被拦截且文案也复制不了时才提示失败', async () => {
    openBlankWindowMock.mockReturnValue(null)
    openOrNavigateMock.mockReturnValue(false)
    copyTextMock.mockResolvedValue(false)
    await readyPanel()
    fireEvent.click(screen.getByRole('button', { name: t('share.platformX', 'zh') }))
    await waitFor(() => expect(copyTextMock).toHaveBeenCalledTimes(1))
    expect(await screen.findByRole('status')).toHaveTextContent(t('share.toastFailed', 'zh'))
  })

  it('Reddit / LINE 仍然是带渠道参数的普通链接', async () => {
    await readyPanel()
    const reddit = screen.getByRole('link', { name: t('share.platformReddit', 'zh') }) as HTMLAnchorElement
    expect(reddit.href).toContain(encodeURIComponent('https://seichigo.com/s/AbC12xYz?c=rd'))
    const line = screen.getByRole('link', { name: t('share.platformLine', 'zh') }) as HTMLAnchorElement
    expect(line.href).toContain('https://social-plugins.line.me/lineit/share?url=')
    expect(line.href).toContain(encodeURIComponent('https://seichigo.com/s/AbC12xYz?c=ln'))
  })

  it.each([
    ['zh', '须贺神社｜你的名字。'],
    ['en', '须贺神社 - 你的名字。'],
    ['ja', '须贺神社｜你的名字。'],
  ] as const)('Reddit 标题走 share.redditTitle 三语模板（%s）', async (locale, expected) => {
    render(<PointSharePanel {...PROPS} locale={locale} />)
    fireEvent.load(await screen.findByAltText(t('share.panelTitle', locale)))
    const reddit = (await screen.findByRole('link', {
      name: t('share.platformReddit', locale),
    })) as HTMLAnchorElement
    expect(reddit.href).toContain(encodeURIComponent(expected))
  })

  it('小红书：一次点击 = 下载图片 + 复制文案 + 提示打开小红书', async () => {
    await readyPanel()
    fireEvent.click(screen.getByRole('button', { name: t('share.platformXiaohongshu', 'zh') }))
    await waitFor(() => expect(downloadBlobMock).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(copyTextMock).toHaveBeenCalledTimes(1))
    expect(String(copyTextMock.mock.calls[0]![0])).toContain('?c=xhs')
    expect(await screen.findByRole('status')).toHaveTextContent(
      t('share.toastSavedAndCopiedOpenApp', 'zh').replace('{app}', t('share.platformXiaohongshu', 'zh')),
    )
  })

  it('微信：同样一次点击做完，提示里的 app 换成微信', async () => {
    await readyPanel()
    fireEvent.click(screen.getByRole('button', { name: t('share.platformWechat', 'zh') }))
    await waitFor(() => expect(copyTextMock).toHaveBeenCalledTimes(1))
    expect(String(copyTextMock.mock.calls[0]![0])).toContain('?c=wx')
    expect(await screen.findByRole('status')).toHaveTextContent(
      t('share.toastSavedAndCopiedOpenApp', 'zh').replace('{app}', t('share.platformWechat', 'zh')),
    )
  })

  it('小红书：文案复制失败时只提示图片已保存', async () => {
    copyTextMock.mockResolvedValue(false)
    await readyPanel()
    fireEvent.click(screen.getByRole('button', { name: t('share.platformXiaohongshu', 'zh') }))
    await waitFor(() => expect(downloadBlobMock).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(copyTextMock).toHaveBeenCalledTimes(1))
    const toast = await screen.findByRole('status')
    expect(toast.textContent).toBe(t('share.toastSaved', 'zh'))
  })

  it('微信：文案复制失败时只提示图片已保存', async () => {
    copyTextMock.mockResolvedValue(false)
    await readyPanel()
    fireEvent.click(screen.getByRole('button', { name: t('share.platformWechat', 'zh') }))
    await waitFor(() => expect(copyTextMock).toHaveBeenCalledTimes(1))
    const toast = await screen.findByRole('status')
    expect(toast.textContent).toBe(t('share.toastSaved', 'zh'))
  })

  it('保存图片在主区，复制图片/复制文案收进「更多」', async () => {
    await readyPanel()
    expect(screen.getByRole('button', { name: t('share.saveImage', 'zh') })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t('share.copyImage', 'zh') })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t('share.copyText', 'zh') })).not.toBeInTheDocument()

    const more = screen.getByRole('button', { name: t('share.more', 'zh') })
    expect(more).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(more)
    expect(more).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: t('share.copyImage', 'zh') })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: t('share.copyText', 'zh') }))
    await waitFor(() => expect(copyTextMock).toHaveBeenCalledTimes(1))
    expect(String(copyTextMock.mock.calls[0]![0])).toContain('?c=copy')
  })
})

describe('PointSharePanel 手机路径', () => {
  beforeEach(() => {
    enableSystemShare()
  })

  it('显示「分享到…」主按钮，走系统面板且渠道是 sys、不带文件', async () => {
    await readyPanel()
    const primary = screen.getByRole('button', { name: t('share.shareTo', 'zh') })
    fireEvent.click(primary)
    await waitFor(() => expect(shareViaSystemMock).toHaveBeenCalledTimes(1))
    expect(shareViaSystemMock.mock.calls[0]![0].url).toBe('https://seichigo.com/s/AbC12xYz?c=sys')
    // 系统分享只发链接：预览图由服务端 OG 卡片提供，附文件会让微信/QQ 出现两张图
    expect(shareViaSystemMock.mock.calls[0]![0]).not.toHaveProperty('files')
  })

  it.each([
    ['share.platformX', 'x'],
    ['share.platformReddit', 'rd'],
    ['share.platformLine', 'ln'],
    ['share.platformXiaohongshu', 'xhs'],
    ['share.platformWechat', 'wx'],
  ] as const)('%s 也走系统面板，渠道 %s', async (labelKey, channel) => {
    await readyPanel()
    fireEvent.click(screen.getByRole('button', { name: t(labelKey, 'zh') }))
    await waitFor(() => expect(shareViaSystemMock).toHaveBeenCalledTimes(1))
    expect(shareViaSystemMock.mock.calls[0]![0].url).toBe(
      `https://seichigo.com/s/AbC12xYz?c=${channel}`,
    )
    expect(String(shareViaSystemMock.mock.calls[0]![0].text)).toContain(`?c=${channel}`)
  })

  it('系统面板分享失败时提示失败', async () => {
    shareViaSystemMock.mockResolvedValue('failed')
    await readyPanel()
    fireEvent.click(screen.getByRole('button', { name: t('share.shareTo', 'zh') }))
    expect(await screen.findByRole('status')).toHaveTextContent(t('share.toastFailed', 'zh'))
  })

  it('五个目的地一行排开，字号缩到 text-xs', async () => {
    await readyPanel()
    const grid = screen.getByTestId('share-destinations')
    expect(grid.className).toContain('grid-cols-5')
    expect(grid.className).not.toContain('grid-cols-3')
    const x = screen.getByRole('button', { name: t('share.platformX', 'zh') })
    expect(x.className).toContain('text-xs')
    expect(x.className).not.toContain('text-sm')
  })

  it('「更多」里是保存图片与复制文案，没有复制图片', async () => {
    await readyPanel()
    fireEvent.click(screen.getByRole('button', { name: t('share.more', 'zh') }))
    expect(screen.getByRole('button', { name: t('share.saveImage', 'zh') })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: t('share.copyText', 'zh') })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t('share.copyImage', 'zh') })).not.toBeInTheDocument()
  })
})

describe('PointSharePanel 目的地区占位', () => {
  it('shareUrl 暂时为空时 Reddit / LINE 没有 href，且是 aria-disabled', async () => {
    await readyPanel()
    // 换版式会重建短链：shareUrl 清空期间目的地网格保持可见但禁用
    createShareLinkMock.mockReturnValue(new Promise(() => {}))
    fireEvent.click(screen.getByRole('button', { name: t('share.layoutLandscape', 'zh') }))
    // 没有 href 的 <a> 已经不是 link role 了，按文字取元素
    const reddit = screen.getByText(t('share.platformReddit', 'zh'))
    await waitFor(() => expect(reddit).not.toHaveAttribute('href'))
    expect(reddit).toHaveAttribute('aria-disabled', 'true')
    const line = screen.getByText(t('share.platformLine', 'zh'))
    expect(line).not.toHaveAttribute('href')
    expect(line).toHaveAttribute('aria-disabled', 'true')
  })
})
