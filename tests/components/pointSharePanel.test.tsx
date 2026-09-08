import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import PointSharePanel from '@/components/share/PointSharePanel'
import { t } from '@/lib/i18n'

// 卡片渲染器在 jsdom 里没有 canvas，直接桩成「立刻回调一个 Blob」
let lastCardInput: Record<string, unknown> | null = null
vi.mock('@/components/share/PointShareCard', () => ({
  default: ({ input, onRendered }: { input: Record<string, unknown>; onRendered: (blob: Blob) => void }) => {
    lastCardInput = input
    const blob = new Blob([new Uint8Array(1)], { type: 'image/jpeg' })
    setTimeout(() => onRendered(blob), 0)
    return <canvas data-testid="stub-card" />
  },
}))

const createShareLinkMock = vi.fn()
const uploadShareAssetsMock = vi.fn()
const transcodeToJpegMock = vi.fn()
const copyImageMock = vi.fn()
const downloadBlobMock = vi.fn()
const fetchPointContextMock = vi.fn()
vi.mock('@/components/share/shareClient', async () => {
  const actual = await vi.importActual<typeof import('@/components/share/shareClient')>(
    '@/components/share/shareClient',
  )
  return {
    ...actual,
    createShareLink: (...args: any[]) => createShareLinkMock(...args),
    uploadShareAssets: (...args: any[]) => uploadShareAssetsMock(...args),
    transcodeToJpeg: (...args: any[]) => transcodeToJpegMock(...args),
    copyImage: (...args: any[]) => copyImageMock(...args),
    downloadBlob: (...args: any[]) => downloadBlobMock(...args),
    fetchPointContext: (...args: any[]) => fetchPointContextMock(...args),
  }
})

const useSessionMock = vi.fn()
vi.mock('next-auth/react', () => ({
  useSession: () => useSessionMock(),
}))

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

beforeEach(() => {
  createShareLinkMock.mockReset()
  uploadShareAssetsMock.mockReset()
  useSessionMock.mockReset()
  useSessionMock.mockReturnValue({ data: { user: { name: 'u' } }, status: 'authenticated' })
  transcodeToJpegMock.mockReset()
  transcodeToJpegMock.mockResolvedValue(new Blob([new Uint8Array(1)], { type: 'image/jpeg' }))
  copyImageMock.mockReset()
  downloadBlobMock.mockReset()
  fetchPointContextMock.mockReset()
  fetchPointContextMock.mockResolvedValue({
    address: '東京都 新宿区 須賀町',
    geo: [35.68, 139.72],
    note: '楼梯在神社南侧',
    inJapan: true,
    displayName: '须贺神社',
    animeTitle: '你的名字。',
  })
  createShareLinkMock.mockResolvedValue({
    code: 'AbC12xYz',
    url: 'https://seichigo.com/s/AbC12xYz',
  })
  uploadShareAssetsMock.mockResolvedValue(null)
  globalThis.localStorage.clear()
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:preview')
  globalThis.URL.revokeObjectURL = vi.fn()
})

describe('PointSharePanel 三语渲染', () => {
  it.each(['zh', 'en', 'ja'] as const)('%s 用对应语言的按钮文案', async (locale) => {
    render(<PointSharePanel {...PROPS} locale={locale} />)
    expect(screen.getByText(t('share.panelTitle', locale))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: t('share.saveImage', locale) })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: t('share.layoutPortrait', locale) })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: t('share.layoutLandscape', locale) })).toBeInTheDocument()
  })
})

describe('PointSharePanel 短链与平台按钮', () => {
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

  it('平台按钮 href 带正确的渠道参数与编码', async () => {
    render(<PointSharePanel {...PROPS} />)
    await waitFor(() => expect(screen.getByRole('link', { name: 'X' })).toBeInTheDocument())

    const x = screen.getByRole('link', { name: 'X' }) as HTMLAnchorElement
    expect(x.href).toContain('https://twitter.com/intent/tweet?text=')
    expect(decodeURIComponent(x.href)).toContain('https://seichigo.com/s/AbC12xYz?c=x')

    const reddit = screen.getByRole('link', { name: 'Reddit' }) as HTMLAnchorElement
    expect(reddit.href).toContain(encodeURIComponent('https://seichigo.com/s/AbC12xYz?c=rd'))

    const line = screen.getByRole('link', { name: 'LINE' }) as HTMLAnchorElement
    expect(line.href).toContain('https://social-plugins.line.me/lineit/share?url=')
    expect(line.href).toContain(encodeURIComponent('https://seichigo.com/s/AbC12xYz?c=ln'))
  })

  it('切到横版会用新版式再建一条短链，并记住选择', async () => {
    render(<PointSharePanel {...PROPS} />)
    await waitFor(() => expect(createShareLinkMock).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: t('share.layoutLandscape', 'zh') }))
    await waitFor(() => expect(createShareLinkMock).toHaveBeenCalledTimes(2))
    expect(createShareLinkMock.mock.calls[1]![0].layout).toBe('landscape')
    expect(globalThis.localStorage.getItem('seichigo.share.layout')).toBe('landscape')
  })

  it('未登录时不发上传请求', async () => {
    useSessionMock.mockReturnValue({ data: null, status: 'unauthenticated' })
    render(<PointSharePanel {...PROPS} />)
    await waitFor(() => expect(createShareLinkMock).toHaveBeenCalledTimes(1))
    // 等卡片桩的渲染回调全部跑完再断言
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(uploadShareAssetsMock).not.toHaveBeenCalled()
  })

  it('登录后卡片渲染完成会静默上传一次', async () => {
    render(<PointSharePanel {...PROPS} />)
    await waitFor(() => expect(uploadShareAssetsMock).toHaveBeenCalledTimes(1))
    expect(uploadShareAssetsMock.mock.calls[0]![0]).toBe('AbC12xYz')
  })

  it('传给卡片的二维码输入带 c=save 渠道参数', async () => {
    render(<PointSharePanel {...PROPS} />)
    await waitFor(() => expect(lastCardInput?.shareUrl).toBe('https://seichigo.com/s/AbC12xYz'))
    expect(lastCardInput?.qrUrl).toBe('https://seichigo.com/s/AbC12xYz?c=save')
  })

  it('建短链失败时显示失败提示与重试按钮，点击后重新请求', async () => {
    createShareLinkMock.mockResolvedValueOnce(null)
    render(<PointSharePanel {...PROPS} />)
    const retry = await screen.findByRole('button', { name: t('share.retry', 'zh') })
    expect(screen.getByText(t('share.generateFailed', 'zh'))).toBeInTheDocument()
    // 短链未就绪时平台入口是禁用态（无 href，getByRole('link') 匹配不到，用文本找）
    const x = screen.getByText('X').closest('a')!
    expect(x).toHaveAttribute('aria-disabled', 'true')
    expect(x.className).toContain('pointer-events-none')
    fireEvent.click(retry)
    await waitFor(() => expect(createShareLinkMock).toHaveBeenCalledTimes(2))
    // 重试成功后平台链接出现
    await screen.findByRole('link', { name: 'X' })
  })

  it('加实拍后切换版式，仍在使用的实拍 objectURL 不会被 revoke', async () => {
    let n = 0
    const createMock = vi.fn(() => `blob:${++n}`)
    const revokeMock = vi.fn()
    globalThis.URL.createObjectURL = createMock
    globalThis.URL.revokeObjectURL = revokeMock

    const { container } = render(<PointSharePanel {...PROPS} />)
    await waitFor(() => expect(createShareLinkMock).toHaveBeenCalledTimes(1))

    const fileInput = container.querySelector('input[type="file"]')!
    const file = new File([new Uint8Array(10)], 'photo.jpg', { type: 'image/jpeg' })
    fireEvent.change(fileInput, { target: { files: [file] } })
    const photoUrl = createMock.mock.results[createMock.mock.results.length - 1]!.value as string
    expect(photoUrl).toMatch(/^blob:/)

    fireEvent.click(screen.getByRole('button', { name: t('share.layoutLandscape', 'zh') }))
    await waitFor(() => expect(createShareLinkMock).toHaveBeenCalledTimes(2))
    // 等卡片桩的 setTimeout 全部跑完，再断言实拍 URL 从头到尾没被 revoke
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(revokeMock).not.toHaveBeenCalledWith(photoUrl)
  })

  it('超过 5MB 的实拍被拒绝并提示，不发 createObjectURL', async () => {
    const createMock = vi.fn(() => 'blob:never')
    globalThis.URL.createObjectURL = createMock
    const { container } = render(<PointSharePanel {...PROPS} />)
    const fileInput = container.querySelector('input[type="file"]')!
    const big = new File([new Uint8Array(1)], 'big.jpg', { type: 'image/jpeg' })
    Object.defineProperty(big, 'size', { value: 6_000_000 })
    fireEvent.change(fileInput, { target: { files: [big] } })
    expect(await screen.findByRole('status')).toHaveTextContent(t('share.toastPhotoTooLarge', 'zh'))
    expect(createMock).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: t('share.addPhoto', 'zh') })).toBeInTheDocument()
  })

  it('HEIC 等非 jpeg/png/webp 走 JPEG 转码后入槽', async () => {
    const { container } = render(<PointSharePanel {...PROPS} />)
    const fileInput = container.querySelector('input[type="file"]')!
    const heic = new File([new Uint8Array(10)], 'photo.heic', { type: 'image/heic' })
    fireEvent.change(fileInput, { target: { files: [heic] } })
    await waitFor(() => expect(transcodeToJpegMock).toHaveBeenCalledTimes(1))
    expect(await screen.findByRole('button', { name: t('share.removePhoto', 'zh') })).toBeInTheDocument()
  })

  it('转码失败提示不支持并清空选择', async () => {
    transcodeToJpegMock.mockResolvedValue(null)
    const { container } = render(<PointSharePanel {...PROPS} />)
    const fileInput = container.querySelector('input[type="file"]')!
    const gif = new File([new Uint8Array(10)], 'dance.gif', { type: 'image/gif' })
    fireEvent.change(fileInput, { target: { files: [gif] } })
    expect(await screen.findByRole('status')).toHaveTextContent(t('share.toastPhotoUnsupported', 'zh'))
    expect(screen.getByRole('button', { name: t('share.addPhoto', 'zh') })).toBeInTheDocument()
  })

  it('复制图片不可用时降级为下载并提示已保存', async () => {
    copyImageMock.mockResolvedValue(false)
    render(<PointSharePanel {...PROPS} />)
    const copyBtn = await screen.findByRole('button', { name: t('share.copyImage', 'zh') })
    await waitFor(() => expect(copyBtn).not.toBeDisabled())
    fireEvent.click(copyBtn)
    await waitFor(() => expect(downloadBlobMock).toHaveBeenCalledTimes(1))
    expect(downloadBlobMock.mock.calls[0]![1]).toBe('seichigo-须贺神社.jpg')
    expect(await screen.findByRole('status')).toHaveTextContent(t('share.toastSaved', 'zh'))
  })

  it('添加实拍按钮旁显示 photoHint 提示', async () => {
    render(<PointSharePanel {...PROPS} />)
    expect(screen.getByText(t('share.photoHint', 'zh'))).toBeInTheDocument()
  })

  it('Reddit 标题走 share.redditTitle 模板（zh 用｜连接）', async () => {
    render(<PointSharePanel {...PROPS} />)
    const reddit = (await screen.findByRole('link', { name: 'Reddit' })) as HTMLAnchorElement
    expect(reddit.href).toContain(encodeURIComponent('须贺神社｜你的名字。'))
  })

  it('Reddit 标题走 share.redditTitle 模板（en 用 - 连接）', async () => {
    render(<PointSharePanel {...PROPS} locale="en" />)
    const reddit = (await screen.findByRole('link', { name: 'Reddit' })) as HTMLAnchorElement
    expect(reddit.href).toContain(encodeURIComponent('须贺神社 - 你的名字。'))
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
})

describe('PointSharePanel 点位上下文', () => {
  it('打开时与建短链并行拉一次 point-context', async () => {
    render(<PointSharePanel {...PROPS} />)
    await waitFor(() => expect(fetchPointContextMock).toHaveBeenCalledTimes(1))
    expect(fetchPointContextMock).toHaveBeenCalledWith('101:suga', 'zh')
  })

  it('把地址、说明、坐标、inJapan 与去前缀点位名传给卡片', async () => {
    render(<PointSharePanel {...PROPS} />)
    await waitFor(() => expect(lastCardInput?.address).toBe('東京都 新宿区 須賀町'))
    expect(lastCardInput?.note).toBe('楼梯在神社南侧')
    expect(lastCardInput?.geo).toEqual([35.68, 139.72])
    expect(lastCardInput?.inJapan).toBe(true)
    expect(lastCardInput?.pointName).toBe('须贺神社')
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
    render(<PointSharePanel {...PROPS} pointName="『摇曳露营△ 三期』葡萄牛奶" />)
    await waitFor(() => expect(lastCardInput?.pointName).toBe('葡萄牛奶'))
    expect(lastCardInput?.animeTitle).toBe('摇曳露营△ 三期')
  })

  it('context 拉取失败时按无地址无说明画，不阻塞卡片', async () => {
    fetchPointContextMock.mockResolvedValue(null)
    render(<PointSharePanel {...PROPS} />)
    await waitFor(() => expect(lastCardInput?.shareUrl).toBe('https://seichigo.com/s/AbC12xYz'))
    expect(lastCardInput?.address).toBeNull()
    expect(lastCardInput?.note).toBeNull()
    expect(lastCardInput?.inJapan).toBe(false)
    expect(lastCardInput?.pointName).toBe('须贺神社')
  })

  it('文案带城市级地址（前两级，去掉空格）', async () => {
    render(<PointSharePanel {...PROPS} />)
    await waitFor(() =>
      expect(screen.getByLabelText(t('share.captionLabel', 'zh'))).toHaveValue(
        '《你的名字。》圣地巡礼｜须贺神社 · 東京都新宿区 https://seichigo.com/s/AbC12xYz?c=copy #圣地巡礼 #你的名字。',
      ),
    )
  })

  it('没有地址时文案退回 props 的 cityName', async () => {
    fetchPointContextMock.mockResolvedValue({
      address: null,
      geo: null,
      note: null,
      inJapan: false,
      displayName: '须贺神社',
      animeTitle: '你的名字。',
    })
    render(<PointSharePanel {...PROPS} />)
    await waitFor(() =>
      expect(screen.getByLabelText(t('share.captionLabel', 'zh'))).toHaveValue(
        '《你的名字。》圣地巡礼｜须贺神社 · 东京 https://seichigo.com/s/AbC12xYz?c=copy #圣地巡礼 #你的名字。',
      ),
    )
  })

  it('换版式不重复拉 point-context（跟版式无关）', async () => {
    render(<PointSharePanel {...PROPS} />)
    await waitFor(() => expect(fetchPointContextMock).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: t('share.layoutLandscape', 'zh') }))
    await waitFor(() => expect(createShareLinkMock).toHaveBeenCalledTimes(2))
    expect(fetchPointContextMock).toHaveBeenCalledTimes(1)
  })
})
