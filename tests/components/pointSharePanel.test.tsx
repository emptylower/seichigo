import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import PointSharePanel from '@/components/share/PointSharePanel'
import { t } from '@/lib/i18n'

// 卡片渲染器在 jsdom 里没有 canvas，直接桩成「立刻回调一个 Blob」
let lastCardInput: { shareUrl?: string; qrUrl?: string } | null = null
vi.mock('@/components/share/PointShareCard', () => ({
  default: ({ input, onRendered }: { input: { shareUrl?: string; qrUrl?: string }; onRendered: (blob: Blob) => void }) => {
    lastCardInput = input
    const blob = new Blob([new Uint8Array(1)], { type: 'image/jpeg' })
    setTimeout(() => onRendered(blob), 0)
    return <canvas data-testid="stub-card" />
  },
}))

const createShareLinkMock = vi.fn()
const uploadShareAssetsMock = vi.fn()
vi.mock('@/components/share/shareClient', async () => {
  const actual = await vi.importActual<typeof import('@/components/share/shareClient')>(
    '@/components/share/shareClient',
  )
  return {
    ...actual,
    createShareLink: (...args: any[]) => createShareLinkMock(...args),
    uploadShareAssets: (...args: any[]) => uploadShareAssetsMock(...args),
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

  it('文案预填含作品、地名、城市与短链', async () => {
    render(<PointSharePanel {...PROPS} />)
    await waitFor(() => expect(screen.getByLabelText(t('share.captionLabel', 'zh'))).toHaveValue(
      '《你的名字。》圣地巡礼｜须贺神社（东京）https://seichigo.com/s/AbC12xYz?c=copy #圣地巡礼 #你的名字。',
    ))
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
})
