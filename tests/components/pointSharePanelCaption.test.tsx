import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import PointSharePanel from '@/components/share/PointSharePanel'
import { t } from '@/lib/i18n'

// 卡片渲染器在 jsdom 里没有 canvas，直接桩成「立刻回调一个 Blob」
// blob 内容带上 input 的地址，方便断言「上传的是带地址那一版」
let lastCardInput: Record<string, unknown> | null = null
let cardStubAutoRender = true
vi.mock('@/components/share/PointShareCard', () => ({
  default: ({ input, onRendered }: { input: Record<string, unknown>; onRendered: (blob: Blob) => void }) => {
    lastCardInput = input
    if (cardStubAutoRender) {
      const blob = new Blob([JSON.stringify({ address: input.address ?? null })], {
        type: 'image/jpeg',
      })
      setTimeout(() => onRendered(blob), 0)
    }
    return <canvas data-testid="stub-card" />
  },
}))

const createShareLinkMock = vi.fn()
const uploadShareAssetsMock = vi.fn()
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
    uploadShareAssets: (...args: any[]) => uploadShareAssetsMock(...args),
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
  lastCardInput = null
  cardStubAutoRender = true
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
  canShareFilesMock.mockReset()
  canShareFilesMock.mockReturnValue(false) // 默认桌面路径
  shareViaSystemMock.mockReset()
  shareViaSystemMock.mockResolvedValue('files')
  copyTextMock.mockReset()
  copyTextMock.mockResolvedValue(true)
  copyImageMock.mockResolvedValue(true)
  openBlankWindowMock.mockReset()
  openBlankWindowMock.mockReturnValue({ location: { href: '' } })
  openOrNavigateMock.mockReset()
  openOrNavigateMock.mockReturnValue(true)
  createShareLinkMock.mockResolvedValue({
    code: 'AbC12xYz',
    url: 'https://seichigo.com/s/AbC12xYz',
  })
  uploadShareAssetsMock.mockResolvedValue(null)
  globalThis.localStorage.clear()
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:preview')
  globalThis.URL.revokeObjectURL = vi.fn()
})

async function readyPanel(props = PROPS) {
  render(<PointSharePanel {...props} />)
  await waitFor(() => expect(lastCardInput?.shareUrl).toBe('https://seichigo.com/s/AbC12xYz'))
  await waitFor(() => expect(fetchPointContextMock).toHaveBeenCalled())
  // 再等卡片渲染回调落地（cardBlob 就绪）：两条路径的 X 按钮都从禁用变可点
  await waitFor(() =>
    expect(screen.getByRole('button', { name: t('share.platformX', 'zh') })).not.toBeDisabled(),
  )
}

describe('PointSharePanel 文案折叠与编辑', () => {
  it('折叠摘要先剥掉短链再截 40 字', async () => {
    await readyPanel()
    const collapsed = screen.getByRole('button', { name: t('share.captionLabel', 'zh') })
    // 摘要位置就一行，短链占掉一半没有意义，先剥掉再截
    expect(collapsed.textContent).not.toContain('http')
    expect(collapsed).toHaveTextContent('《你的名字。》圣地巡礼｜须贺神社 · 東京都新宿区 #圣地巡礼 #你的名字。')
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('剥掉短链后仍超过 40 字才加省略号', async () => {
    await readyPanel()
    fireEvent.click(screen.getByRole('button', { name: t('share.captionLabel', 'zh') }))
    const long = `${'字'.repeat(60)} https://seichigo.com/s/AbC12xYz?c=copy`
    fireEvent.change(screen.getByLabelText(t('share.captionLabel', 'zh')), { target: { value: long } })
    fireEvent.click(screen.getByRole('button', { name: t('share.collapseCaption', 'zh') }))
    const collapsed = screen.getByRole('button', { name: t('share.captionLabel', 'zh') })
    expect(collapsed).toHaveTextContent(`${'字'.repeat(40)}…`)
    expect(collapsed.textContent).not.toContain('http')
  })

  it('展开后可以收起，收起按钮带 aria-expanded=true', async () => {
    await readyPanel()
    fireEvent.click(screen.getByRole('button', { name: t('share.captionLabel', 'zh') }))
    const collapse = screen.getByRole('button', { name: t('share.collapseCaption', 'zh') })
    expect(collapse).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(collapse)
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: t('share.captionLabel', 'zh') })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
  })

  it('编辑过才出现「恢复默认」，点了回到生成文案', async () => {
    await readyPanel()
    fireEvent.click(screen.getByRole('button', { name: t('share.captionLabel', 'zh') }))
    expect(screen.queryByRole('button', { name: t('share.resetCaption', 'zh') })).not.toBeInTheDocument()
    const textarea = screen.getByLabelText(t('share.captionLabel', 'zh'))
    fireEvent.change(textarea, { target: { value: '我改过的文案' } })
    fireEvent.click(screen.getByRole('button', { name: t('share.resetCaption', 'zh') }))
    expect(textarea).toHaveValue(
      '《你的名字。》圣地巡礼｜须贺神社 · 東京都新宿区 https://seichigo.com/s/AbC12xYz?c=copy #圣地巡礼 #你的名字。',
    )
    expect(screen.queryByRole('button', { name: t('share.resetCaption', 'zh') })).not.toBeInTheDocument()
  })

  it('展开后可编辑，编辑后的文案用于所有动作且渠道参数被改写', async () => {
    await readyPanel()
    fireEvent.click(screen.getByRole('button', { name: t('share.captionLabel', 'zh') }))
    const textarea = screen.getByLabelText(t('share.captionLabel', 'zh'))
    fireEvent.change(textarea, {
      target: { value: '我改过的文案 https://seichigo.com/s/AbC12xYz?c=copy' },
    })
    fireEvent.click(screen.getByRole('button', { name: t('share.platformXiaohongshu', 'zh') }))
    await waitFor(() => expect(copyTextMock).toHaveBeenCalledTimes(1))
    expect(copyTextMock.mock.calls[0]![0]).toBe(
      '我改过的文案 https://seichigo.com/s/AbC12xYz?c=xhs',
    )
  })

  it('编辑器显示原始输入：用户删掉 ?c=copy 后不回填，动作时才改写渠道', async () => {
    await readyPanel()
    fireEvent.click(screen.getByRole('button', { name: t('share.captionLabel', 'zh') }))
    const textarea = screen.getByLabelText(t('share.captionLabel', 'zh'))
    fireEvent.change(textarea, {
      target: { value: '我的文案 https://seichigo.com/s/AbC12xYz' },
    })
    // 编辑器保持用户输入，不把 ?c=copy 回填进去
    expect(textarea).toHaveValue('我的文案 https://seichigo.com/s/AbC12xYz')
    // 动作那一刻仍按目的地渠道改写
    fireEvent.click(screen.getByRole('button', { name: t('share.platformXiaohongshu', 'zh') }))
    await waitFor(() => expect(copyTextMock).toHaveBeenCalledTimes(1))
    expect(copyTextMock.mock.calls[0]![0]).toBe('我的文案 https://seichigo.com/s/AbC12xYz?c=xhs')
    expect(textarea).toHaveValue('我的文案 https://seichigo.com/s/AbC12xYz')
  })
})
