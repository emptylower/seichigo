import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import PointSharePanel from '@/components/share/PointSharePanel'
import { t } from '@/lib/i18n'

const createShareLinkMock = vi.fn()
const fetchCardBlobMock = vi.fn()
const uploadSharePhotoMock = vi.fn()
const transcodeToJpegMock = vi.fn()
const copyImageMock = vi.fn()
const downloadBlobMock = vi.fn()
const fetchPointContextMock = vi.fn()
const canShareFilesMock = vi.fn()
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
    canShareFiles: (...args: any[]) => canShareFilesMock(...args),
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

function cardBlob(tag = 'card'): Blob {
  return new Blob([tag], { type: 'image/webp' })
}

beforeEach(() => {
  vi.clearAllMocks()
  globalThis.localStorage?.clear()
  useSessionMock.mockReturnValue({ status: 'authenticated' })
  createShareLinkMock.mockResolvedValue({ code: 'AbC12xYz', url: 'https://seichigo.com/s/AbC12xYz' })
  fetchCardBlobMock.mockResolvedValue(cardBlob())
  fetchPointContextMock.mockResolvedValue({
    address: '東京都 新宿区 须贺町',
    geo: [35.6895, 139.7],
    note: '重逢的阶梯',
    inJapan: true,
    displayName: '须贺神社',
    animeTitle: '你的名字。',
  })
  canShareFilesMock.mockReturnValue(false)
  transcodeToJpegMock.mockResolvedValue(new Blob([new Uint8Array(1)], { type: 'image/jpeg' }))
  ;(globalThis.URL as any).createObjectURL ??= vi.fn(() => 'blob:preview')
  ;(globalThis.URL as any).revokeObjectURL ??= vi.fn()
})

describe('PointSharePanel 预览走服务端卡片', () => {
  it('首屏 <img> 直挂竖版卡片 URL，不为预览发 fetch', async () => {
    render(<PointSharePanel {...PROPS} />)
    const img = await screen.findByAltText(t('share.panelTitle', 'zh'))
    expect(img).toHaveAttribute('src', '/api/share/card/101%3Asuga?locale=zh&layout=portrait')
    expect(fetchCardBlobMock).not.toHaveBeenCalled()
  })

  it('加载完成前显示骨架文案，onLoad 后显示预览图', async () => {
    render(<PointSharePanel {...PROPS} />)
    expect(screen.getByText(t('share.generating', 'zh'))).toBeInTheDocument()
    fireEvent.load(screen.getByAltText(t('share.panelTitle', 'zh')))
    await waitFor(() => expect(screen.queryByText(t('share.generating', 'zh'))).toBeNull())
  })

  it('切横版时 img src 换成 landscape 的那条', async () => {
    render(<PointSharePanel {...PROPS} />)
    fireEvent.load(await screen.findByAltText(t('share.panelTitle', 'zh')))
    fireEvent.click(screen.getByText(t('share.layoutLandscape', 'zh')))
    await waitFor(() =>
      expect(screen.getByAltText(t('share.panelTitle', 'zh'))).toHaveAttribute(
        'src',
        '/api/share/card/101%3Asuga?locale=zh&layout=landscape',
      ),
    )
  })

  it('加载失败显示重试，点重试重新加载', async () => {
    render(<PointSharePanel {...PROPS} />)
    fireEvent.error(await screen.findByAltText(t('share.panelTitle', 'zh')))
    await waitFor(() =>
      expect(screen.getByText(t('share.generateFailed', 'zh'))).toBeInTheDocument(),
    )
    fireEvent.click(screen.getByText(t('share.retry', 'zh')))
    // 重试靠 key 变化重挂 img：失败态先消失，再次 onLoad 后恢复预览
    await waitFor(() => expect(screen.queryByText(t('share.generateFailed', 'zh'))).toBeNull())
    fireEvent.load(screen.getByAltText(t('share.panelTitle', 'zh')))
    await waitFor(() => expect(screen.queryByText(t('share.generating', 'zh'))).toBeNull())
  })

  it('保存图片时才第一次取 blob，再点复制图片复用同一份', async () => {
    render(<PointSharePanel {...PROPS} />)
    fireEvent.load(await screen.findByAltText(t('share.panelTitle', 'zh')))
    await waitFor(() => expect(screen.getByText(t('share.saveImage', 'zh'))).not.toBeDisabled())
    expect(fetchCardBlobMock).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText(t('share.saveImage', 'zh')))
    await waitFor(() => expect(downloadBlobMock).toHaveBeenCalledTimes(1))
    expect(fetchCardBlobMock).toHaveBeenCalledTimes(1)
    expect(downloadBlobMock.mock.calls[0][1]).toMatch(/\.webp$/)
    fireEvent.click(screen.getByText(t('share.more', 'zh')))
    fireEvent.click(screen.getByText(t('share.copyImage', 'zh')))
    await waitFor(() => expect(copyImageMock).toHaveBeenCalledTimes(1))
    expect(fetchCardBlobMock).toHaveBeenCalledTimes(1)
  })

  it('动作取图失败只对当前动作提示，预览不受影响', async () => {
    render(<PointSharePanel {...PROPS} />)
    fireEvent.load(await screen.findByAltText(t('share.panelTitle', 'zh')))
    await waitFor(() => expect(screen.getByText(t('share.saveImage', 'zh'))).not.toBeDisabled())
    fetchCardBlobMock.mockResolvedValueOnce(null)
    fireEvent.click(screen.getByText(t('share.saveImage', 'zh')))
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(t('share.toastFailed', 'zh')),
    )
    expect(downloadBlobMock).not.toHaveBeenCalled()
    // 预览还在，没有被打成失败态
    expect(screen.queryByText(t('share.generateFailed', 'zh'))).toBeNull()
  })

  it('不再向上传端点推卡片', async () => {
    render(<PointSharePanel {...PROPS} />)
    fireEvent.load(await screen.findByAltText(t('share.panelTitle', 'zh')))
    await waitFor(() => expect(screen.getByText(t('share.saveImage', 'zh'))).toBeInTheDocument())
    expect(uploadSharePhotoMock).not.toHaveBeenCalled()
  })
})

describe('添加实拍', () => {
  /** 等短链就绪：添加实拍按钮从 disabled 变可点 */
  async function waitPhotoEntry(container: HTMLElement) {
    await waitFor(() =>
      expect(screen.getByText(t('share.addPhoto', 'zh'))).not.toBeDisabled(),
    )
    return container.querySelector('input[type="file"]') as HTMLInputElement
  }

  it('登录用户选图后上传并用 photo 参数刷新预览', async () => {
    uploadSharePhotoMock.mockResolvedValue({
      ok: true,
      imageUrl: null,
      photoUrl: '/api/share/photo/u1/101%3Asuga',
      photoKey: 'checkin/u1/101:suga.jpg',
    })
    const { container } = render(<PointSharePanel {...PROPS} />)
    const input = await waitPhotoEntry(container)
    const file = new File([new Uint8Array([1])], 'p.jpg', { type: 'image/jpeg' })
    fireEvent.change(input, { target: { files: [file] } })
    await waitFor(() => expect(uploadSharePhotoMock).toHaveBeenCalledWith('AbC12xYz', file))
    await waitFor(() =>
      expect(screen.getByAltText(t('share.panelTitle', 'zh'))).toHaveAttribute(
        'src',
        expect.stringContaining('photo=checkin%2Fu1%2F101%3Asuga.jpg'),
      ),
    )
  })

  it('上传失败时提示且不改卡片 URL', async () => {
    uploadSharePhotoMock.mockResolvedValue(null)
    const { container } = render(<PointSharePanel {...PROPS} />)
    const input = await waitPhotoEntry(container)
    fireEvent.change(input, {
      target: { files: [new File([new Uint8Array([1])], 'p.jpg', { type: 'image/jpeg' })] },
    })
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(t('share.toastFailed', 'zh')))
    expect(screen.getByAltText(t('share.panelTitle', 'zh'))).toHaveAttribute(
      'src',
      '/api/share/card/101%3Asuga?locale=zh&layout=portrait',
    )
  })

  it('超过 5MB 直接提示，不上传', async () => {
    const { container } = render(<PointSharePanel {...PROPS} />)
    const input = await waitPhotoEntry(container)
    const big = new File([new Uint8Array(5_000_001)], 'p.jpg', { type: 'image/jpeg' })
    fireEvent.change(input, { target: { files: [big] } })
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(t('share.toastPhotoTooLarge', 'zh')),
    )
    expect(uploadSharePhotoMock).not.toHaveBeenCalled()
  })

  // 上传端点只收 JPEG：PNG/WebP 虽然 <img> 能显示，也必须先转码再传
  it.each(['image/png', 'image/webp'])('%s 先转码成 JPEG 再上传', async (type) => {
    uploadSharePhotoMock.mockResolvedValue({
      ok: true,
      imageUrl: null,
      photoUrl: '/api/share/photo/u1/101%3Asuga',
      photoKey: 'checkin/u1/101:suga.jpg',
    })
    const { container } = render(<PointSharePanel {...PROPS} />)
    const input = await waitPhotoEntry(container)
    const ext = type === 'image/png' ? 'png' : 'webp'
    const file = new File([new Uint8Array([1])], `p.${ext}`, { type })
    fireEvent.change(input, { target: { files: [file] } })
    await waitFor(() => expect(transcodeToJpegMock).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(uploadSharePhotoMock).toHaveBeenCalledTimes(1))
    const uploaded = uploadSharePhotoMock.mock.calls[0][1] as File
    expect(uploaded.type).toBe('image/jpeg')
    expect(uploaded.name).toBe('p.jpg')
  })

  it('原图超 5MB 但转码后小于 5MB 时照常上传', async () => {
    uploadSharePhotoMock.mockResolvedValue({
      ok: true,
      imageUrl: null,
      photoUrl: '/api/share/photo/u1/101%3Asuga',
      photoKey: 'checkin/u1/101:suga.jpg',
    })
    const { container } = render(<PointSharePanel {...PROPS} />)
    const input = await waitPhotoEntry(container)
    const big = new File([new Uint8Array(5_000_001)], 'raw.png', { type: 'image/png' })
    fireEvent.change(input, { target: { files: [big] } })
    await waitFor(() => expect(transcodeToJpegMock).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(uploadSharePhotoMock).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('转码后仍超 5MB 才提示过大且不上传', async () => {
    transcodeToJpegMock.mockResolvedValue(new Blob([new Uint8Array(5_000_001)], { type: 'image/jpeg' }))
    const { container } = render(<PointSharePanel {...PROPS} />)
    const input = await waitPhotoEntry(container)
    const png = new File([new Uint8Array([1])], 'p.png', { type: 'image/png' })
    fireEvent.change(input, { target: { files: [png] } })
    await waitFor(() => expect(transcodeToJpegMock).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(t('share.toastPhotoTooLarge', 'zh')),
    )
    expect(uploadSharePhotoMock).not.toHaveBeenCalled()
  })

  it('未登录时显示需登录态且不打开文件选择', async () => {
    useSessionMock.mockReturnValue({ status: 'unauthenticated' })
    render(<PointSharePanel {...PROPS} />)
    await screen.findByAltText(t('share.panelTitle', 'zh'))
    expect(screen.getByText(t('share.addPhotoLoginRequired', 'zh'))).toBeInTheDocument()
    expect(screen.queryByText(t('share.addPhoto', 'zh'))).toBeNull()
  })

  it('未登录时点击跳登录页并带 callbackUrl', async () => {
    useSessionMock.mockReturnValue({ status: 'unauthenticated' })
    const assign = vi.fn()
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { href: 'https://seichigo.com/map', assign },
    })
    render(<PointSharePanel {...PROPS} />)
    await screen.findByAltText(t('share.panelTitle', 'zh'))
    fireEvent.click(screen.getByText(t('share.addPhotoLoginRequired', 'zh')))
    expect(assign).toHaveBeenCalledWith(
      '/auth/signin?callbackUrl=https%3A%2F%2Fseichigo.com%2Fmap',
    )
  })
})

describe('目的地与文案（回归）', () => {
  it('卡片没就绪时先出骨架', async () => {
    render(<PointSharePanel {...PROPS} />)
    await screen.findByAltText(t('share.panelTitle', 'zh'))
    expect(screen.getByTestId('share-destinations-skeleton')).toBeInTheDocument()
  })

  it('取图失败时不渲染骨架，目的地网格禁用但可见', async () => {
    render(<PointSharePanel {...PROPS} />)
    fireEvent.error(await screen.findByAltText(t('share.panelTitle', 'zh')))
    await waitFor(() => expect(screen.getByTestId('share-destinations')).toBeInTheDocument())
    expect(screen.queryByTestId('share-destinations-skeleton')).toBeNull()
    expect(screen.getByText(t('share.platformX', 'zh'))).toBeDisabled()
    expect(screen.getByText(t('share.saveImage', 'zh'))).toBeDisabled()
    // 「更多 → 复制文案」不依赖卡片图，失败态下仍然可用
    fireEvent.click(screen.getByText(t('share.more', 'zh')))
    await waitFor(() => expect(screen.getByText(t('share.copyText', 'zh'))).not.toBeDisabled())
  })

  it('建短链失败时目的地网格同样禁用可见', async () => {
    createShareLinkMock.mockResolvedValue(null)
    render(<PointSharePanel {...PROPS} />)
    await screen.findByAltText(t('share.panelTitle', 'zh'))
    await waitFor(() => expect(screen.getByTestId('share-destinations')).toBeInTheDocument())
    expect(screen.queryByTestId('share-destinations-skeleton')).toBeNull()
    expect(screen.getByText(t('share.platformX', 'zh'))).toBeDisabled()
  })

  it('桌面路径出三列六个目的地', async () => {
    render(<PointSharePanel {...PROPS} />)
    fireEvent.load(await screen.findByAltText(t('share.panelTitle', 'zh')))
    await waitFor(() => expect(screen.getByTestId('share-destinations')).toBeInTheDocument())
    expect(screen.getByText(t('share.platformX', 'zh'))).toBeInTheDocument()
    expect(screen.getByText(t('share.saveImage', 'zh'))).toBeInTheDocument()
  })

  it('手机路径走系统面板并带渠道参数', async () => {
    canShareFilesMock.mockReturnValue(true)
    shareViaSystemMock.mockResolvedValue('files')
    render(<PointSharePanel {...PROPS} />)
    fireEvent.load(await screen.findByAltText(t('share.panelTitle', 'zh')))
    await waitFor(() => expect(screen.getByTestId('share-destinations')).toBeInTheDocument())
    fireEvent.click(screen.getByText(t('share.platformXiaohongshu', 'zh')))
    await waitFor(() => expect(shareViaSystemMock).toHaveBeenCalled())
    expect(shareViaSystemMock.mock.calls[0][0].url).toBe('https://seichigo.com/s/AbC12xYz?c=xhs')
  })
})
