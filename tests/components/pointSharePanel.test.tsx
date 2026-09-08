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
  ;(globalThis.URL as any).createObjectURL ??= vi.fn(() => 'blob:preview')
  ;(globalThis.URL as any).revokeObjectURL ??= vi.fn()
})

describe('PointSharePanel 预览走服务端卡片', () => {
  it('首屏用竖版卡片 URL 取图', async () => {
    render(<PointSharePanel {...PROPS} />)
    await waitFor(() => expect(fetchCardBlobMock).toHaveBeenCalled())
    expect(fetchCardBlobMock.mock.calls[0][0]).toBe(
      '/api/share/card/101%3Asuga?locale=zh&layout=portrait',
    )
  })

  it('取到图之前显示骨架文案，取到后显示预览图', async () => {
    let resolveCard: (blob: Blob) => void = () => {}
    fetchCardBlobMock.mockReturnValue(new Promise<Blob>((resolve) => { resolveCard = resolve }))
    render(<PointSharePanel {...PROPS} />)
    expect(screen.getByText(t('share.generating', 'zh'))).toBeInTheDocument()
    resolveCard(cardBlob())
    await waitFor(() =>
      expect(screen.getByAltText(t('share.panelTitle', 'zh'))).toBeInTheDocument(),
    )
  })

  it('切横版时换 layout 参数重新取图', async () => {
    render(<PointSharePanel {...PROPS} />)
    await waitFor(() => expect(fetchCardBlobMock).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByText(t('share.layoutLandscape', 'zh')))
    await waitFor(() => expect(fetchCardBlobMock).toHaveBeenCalledTimes(2))
    expect(fetchCardBlobMock.mock.calls[1][0]).toBe(
      '/api/share/card/101%3Asuga?locale=zh&layout=landscape',
    )
  })

  it('取图失败显示重试，点重试重新取', async () => {
    fetchCardBlobMock.mockResolvedValueOnce(null)
    render(<PointSharePanel {...PROPS} />)
    await waitFor(() => expect(screen.getByText(t('share.generateFailed', 'zh'))).toBeInTheDocument())
    fireEvent.click(screen.getByText(t('share.retry', 'zh')))
    await waitFor(() => expect(fetchCardBlobMock).toHaveBeenCalledTimes(2))
  })

  it('保存图片用的是取回来的那个 blob，不再发第二次请求', async () => {
    render(<PointSharePanel {...PROPS} />)
    await waitFor(() => expect(screen.getByAltText(t('share.panelTitle', 'zh'))).toBeInTheDocument())
    fireEvent.click(screen.getByText(t('share.saveImage', 'zh')))
    await waitFor(() => expect(downloadBlobMock).toHaveBeenCalledTimes(1))
    expect(downloadBlobMock.mock.calls[0][1]).toMatch(/\.webp$/)
    expect(fetchCardBlobMock).toHaveBeenCalledTimes(1)
  })

  it('不再向上传端点推卡片', async () => {
    render(<PointSharePanel {...PROPS} />)
    await waitFor(() => expect(screen.getByAltText(t('share.panelTitle', 'zh'))).toBeInTheDocument())
    expect(uploadSharePhotoMock).not.toHaveBeenCalled()
  })
})

describe('添加实拍', () => {
  it('登录用户选图后上传并用 photo 参数重取卡片', async () => {
    uploadSharePhotoMock.mockResolvedValue({
      ok: true,
      imageUrl: null,
      photoUrl: '/api/share/photo/u1/101%3Asuga',
      photoKey: 'checkin/u1/101:suga.jpg',
    })
    const { container } = render(<PointSharePanel {...PROPS} />)
    await waitFor(() => expect(fetchCardBlobMock).toHaveBeenCalledTimes(1))
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File([new Uint8Array([1])], 'p.jpg', { type: 'image/jpeg' })
    fireEvent.change(input, { target: { files: [file] } })
    await waitFor(() => expect(uploadSharePhotoMock).toHaveBeenCalledWith('AbC12xYz', file))
    await waitFor(() => expect(fetchCardBlobMock).toHaveBeenCalledTimes(2))
    expect(fetchCardBlobMock.mock.calls[1][0]).toContain('photo=checkin%2Fu1%2F101%3Asuga.jpg')
  })

  it('上传失败时提示且不改卡片 URL', async () => {
    uploadSharePhotoMock.mockResolvedValue(null)
    const { container } = render(<PointSharePanel {...PROPS} />)
    await waitFor(() => expect(fetchCardBlobMock).toHaveBeenCalledTimes(1))
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, {
      target: { files: [new File([new Uint8Array([1])], 'p.jpg', { type: 'image/jpeg' })] },
    })
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(t('share.toastFailed', 'zh')))
    expect(fetchCardBlobMock).toHaveBeenCalledTimes(1)
  })

  it('超过 5MB 直接提示，不上传', async () => {
    const { container } = render(<PointSharePanel {...PROPS} />)
    await waitFor(() => expect(fetchCardBlobMock).toHaveBeenCalledTimes(1))
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    const big = new File([new Uint8Array(5_000_001)], 'p.jpg', { type: 'image/jpeg' })
    fireEvent.change(input, { target: { files: [big] } })
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(t('share.toastPhotoTooLarge', 'zh')),
    )
    expect(uploadSharePhotoMock).not.toHaveBeenCalled()
  })

  it('未登录时显示需登录态且不打开文件选择', async () => {
    useSessionMock.mockReturnValue({ status: 'unauthenticated' })
    render(<PointSharePanel {...PROPS} />)
    await waitFor(() => expect(fetchCardBlobMock).toHaveBeenCalled())
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
    await waitFor(() => expect(fetchCardBlobMock).toHaveBeenCalled())
    fireEvent.click(screen.getByText(t('share.addPhotoLoginRequired', 'zh')))
    expect(assign).toHaveBeenCalledWith(
      '/auth/signin?callbackUrl=https%3A%2F%2Fseichigo.com%2Fmap',
    )
  })
})

describe('目的地与文案（回归）', () => {
  it('卡片没就绪时先出骨架', () => {
    fetchCardBlobMock.mockReturnValue(new Promise(() => {}))
    render(<PointSharePanel {...PROPS} />)
    expect(screen.getByTestId('share-destinations-skeleton')).toBeInTheDocument()
  })

  it('桌面路径出三列六个目的地', async () => {
    render(<PointSharePanel {...PROPS} />)
    await waitFor(() => expect(screen.getByTestId('share-destinations')).toBeInTheDocument())
    expect(screen.getByText(t('share.platformX', 'zh'))).toBeInTheDocument()
    expect(screen.getByText(t('share.saveImage', 'zh'))).toBeInTheDocument()
  })

  it('手机路径走系统面板并带渠道参数', async () => {
    canShareFilesMock.mockReturnValue(true)
    shareViaSystemMock.mockResolvedValue('files')
    render(<PointSharePanel {...PROPS} />)
    await waitFor(() => expect(screen.getByTestId('share-destinations')).toBeInTheDocument())
    fireEvent.click(screen.getByText(t('share.platformXiaohongshu', 'zh')))
    await waitFor(() => expect(shareViaSystemMock).toHaveBeenCalled())
    expect(shareViaSystemMock.mock.calls[0][0].url).toBe('https://seichigo.com/s/AbC12xYz?c=xhs')
  })
})
