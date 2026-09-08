'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSession } from 'next-auth/react'
import { Camera, ChevronRight, Copy, Download, Loader2, LogIn, Share2, X } from 'lucide-react'
import { t } from '@/lib/i18n'
import type { SupportedLocale } from '@/lib/i18n/types'
import {
  SHARE_PHOTO_MAX_BYTES,
  buildCardImagePath,
  type PointContextResponse,
  type ShareCardLayout,
  type ShareChannel,
} from '@/lib/share/types'
import {
  buildCardFilename,
  buildLineShareUrl,
  buildRedditSubmitUrl,
  buildShareCaption,
  buildXIntentUrl,
  retargetCaptionChannel,
  toCityLevelAddress,
  withShareChannel,
} from '@/components/share/shareText'
import {
  blobToFile,
  canShareFiles,
  copyImage,
  copyText,
  createShareLink,
  downloadBlob,
  fetchCardBlob,
  fetchPointContext,
  openBlankWindow,
  openOrNavigate,
  readPreferredLayout,
  shareViaSystem,
  transcodeToJpeg,
  uploadSharePhoto,
  writePreferredLayout,
} from '@/components/share/shareClient'

export type PointSharePanelProps = {
  pointId: string
  bangumiId: number
  pointName: string
  animeTitle: string
  cityName: string
  /** 卡片改服务端渲染后由后端从库里读，这两项保留只为不动 MapDialogs 的调用点 */
  episode: string | null
  scene: string | null
  animeImage: string
  locale?: SupportedLocale
  onClose?: () => void
}

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50'

/** 上传端点只收 JPEG（lib/share/handlers/upload.ts，其余类型 415）；PNG/WebP/HEIC 一律先转码再传 */
const UPLOADABLE_PHOTO_TYPES = new Set(['image/jpeg'])

/** 手机路径下五个目的地都走系统面板，只有渠道参数不同 */
const MOBILE_DESTINATIONS: ReadonlyArray<{ channel: ShareChannel; labelKey: string }> = [
  { channel: 'x', labelKey: 'share.platformX' },
  { channel: 'rd', labelKey: 'share.platformReddit' },
  { channel: 'ln', labelKey: 'share.platformLine' },
  { channel: 'xhs', labelKey: 'share.platformXiaohongshu' },
  { channel: 'wx', labelKey: 'share.platformWechat' },
]

const CAPTION_COLLAPSED_MAX = 40

export default function PointSharePanel({
  pointId,
  bangumiId,
  pointName,
  animeTitle,
  cityName,
  locale = 'zh',
  onClose,
}: PointSharePanelProps) {
  // 首屏固定 portrait：useState 初值在 SSR 也会跑，直接读 localStorage 会水合不一致，
  // 挂载后再读本地偏好
  const [layout, setLayout] = useState<ShareCardLayout>('portrait')
  useEffect(() => {
    setLayout(readPreferredLayout())
  }, [])
  const [context, setContext] = useState<PointContextResponse | null>(null)
  const [shareUrl, setShareUrl] = useState<string>('')
  const [code, setCode] = useState<string>('')
  const [linkFailed, setLinkFailed] = useState(false)
  const [photoKey, setPhotoKey] = useState<string | null>(null)
  const [imgLoaded, setImgLoaded] = useState(false)
  const [cardFailed, setCardFailed] = useState(false)
  const [retryNonce, setRetryNonce] = useState(0)
  const [toast, setToast] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [captionOverride, setCaptionOverride] = useState<string | null>(null)
  const [captionExpanded, setCaptionExpanded] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { status: sessionStatus } = useSession()
  const signedIn = sessionStatus === 'authenticated'

  // 版式变了就换一条短链：短链上记录了 layout，分享出去的那条要对得上
  useEffect(() => {
    let cancelled = false
    setShareUrl('')
    setCode('')
    setLinkFailed(false)
    createShareLink({ pointId, bangumiId, locale, layout }).then((result) => {
      if (cancelled) return
      if (!result) {
        setLinkFailed(true)
        return
      }
      setShareUrl(result.url)
      setCode(result.code)
    })
    return () => {
      cancelled = true
    }
  }, [pointId, bangumiId, locale, layout, retryNonce])

  // 文案里的地址要它；卡片本身已经由服务端读同一份上下文，前端不再等它
  useEffect(() => {
    let cancelled = false
    setContext(null)
    fetchPointContext(pointId, locale).then((result) => {
      if (cancelled) return
      setContext(result)
    })
    return () => {
      cancelled = true
    }
  }, [pointId, locale, retryNonce])

  const cardUrl = useMemo(
    () => buildCardImagePath(pointId, locale, layout, photoKey),
    [pointId, locale, layout, photoKey],
  )

  // 预览直挂 <img src={cardUrl}>：后端降级是 302 到跨域图床（无 CORS 头），fetch 必抛错，
  // 但 <img> 不受此限。加载态由 onLoad/onError 上报；cardUrl 变化后旧状态作废。
  useEffect(() => {
    setImgLoaded(false)
    setCardFailed(false)
  }, [cardUrl, retryNonce])

  // 卡片 blob 改成惰性：只有用户点「保存图片」「复制图片」「系统分享」等动作时才取，
  // 按 cardUrl 缓存一份，动作之间复用；失败只对当前动作提示，不影响预览与其它入口
  const cardBlobRef = useRef<{ forCardUrl: string; blob: Blob } | null>(null)
  const getCardBlob = useCallback(async (): Promise<Blob | null> => {
    const cached = cardBlobRef.current
    if (cached && cached.forCardUrl === cardUrl) return cached.blob
    const blob = await fetchCardBlob(cardUrl)
    if (blob) cardBlobRef.current = { forCardUrl: cardUrl, blob }
    return blob
  }, [cardUrl])

  const displayName = context?.displayName?.trim() || pointName
  const cardAnimeTitle = context?.animeTitle?.trim() || animeTitle

  const showToast = useCallback(
    (key: string, vars?: Record<string, string>) => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
      let text = t(key, locale)
      if (vars) {
        for (const [name, value] of Object.entries(vars)) text = text.replace(`{${name}}`, value)
      }
      setToast(text)
      toastTimerRef.current = setTimeout(() => setToast(null), 2600)
    },
    [locale],
  )

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    }
  }, [])

  // 文案里的地址只到市区一级；没拿到 context 时退回作品的 city
  const captionAddress = context?.address
    ? toCityLevelAddress(context.address, locale)
    : String(cityName || '').trim()

  // 生成文案固定带 c=copy：编辑器默认内容 = 「复制文案」动作的结果
  const generatedCaption = buildShareCaption(t('share.captionTemplate', locale), {
    anime: cardAnimeTitle,
    point: displayName,
    address: captionAddress,
    url: shareUrl ? withShareChannel(shareUrl, 'copy') : '',
  })
  const editorValue = captionOverride ?? generatedCaption

  const captionFor = useCallback(
    (channel: ShareChannel) => retargetCaptionChannel(editorValue, shareUrl, channel),
    [editorValue, shareUrl],
  )

  const captionSummarySource = editorValue
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
  const collapsedCaption =
    captionSummarySource.length > CAPTION_COLLAPSED_MAX
      ? `${captionSummarySource.slice(0, CAPTION_COLLAPSED_MAX)}…`
      : captionSummarySource

  // 手机/桌面只看 navigator.canShare({ files })，不看 UA。卡片 blob 改成按需取之后
  // 没有现成文件可探；canShare 只校验结构不看内容，用 1 字节 JPEG 桩探测即可
  const mobilePath = useMemo(() => {
    try {
      return canShareFiles([new File([new Uint8Array([0xff])], 'probe.jpg', { type: 'image/jpeg' })])
    } catch {
      return false
    }
  }, [])

  const goSignIn = () => {
    const back = typeof window !== 'undefined' ? window.location.href : '/'
    window.location.assign(`/auth/signin?callbackUrl=${encodeURIComponent(back)}`)
  }

  const handlePhotoChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    const reset = () => {
      if (fileRef.current) fileRef.current.value = ''
    }
    let next = file
    if (!UPLOADABLE_PHOTO_TYPES.has(file.type)) {
      const transcoded = await transcodeToJpeg(file)
      if (!transcoded) {
        showToast('share.toastPhotoUnsupported')
        reset()
        return
      }
      next = new File([transcoded], `${file.name.replace(/\.[^.]+$/, '') || 'photo'}.jpg`, {
        type: 'image/jpeg',
      })
    }
    // 大小判定放在转码之后：转码通常更小，先判会把能传的大图误杀掉
    if (next.size > SHARE_PHOTO_MAX_BYTES) {
      showToast('share.toastPhotoTooLarge')
      reset()
      return
    }
    if (!code) {
      showToast('share.toastFailed')
      reset()
      return
    }
    setBusy(true)
    try {
      // 先把实拍传上去拿 R2 key，再用带 photo 参数的卡片 URL 刷新预览
      const result = await uploadSharePhoto(code, next)
      if (!result?.photoKey) {
        showToast('share.toastFailed')
        return
      }
      setPhotoKey(result.photoKey)
    } finally {
      setBusy(false)
      reset()
    }
  }

  const removePhoto = () => {
    setPhotoKey(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  const shareToSystem = async (channel: ShareChannel) => {
    if (!shareUrl || busy) return
    setBusy(true)
    try {
      const blob = await getCardBlob()
      if (!blob) {
        showToast('share.toastFailed')
        return
      }
      const result = await shareViaSystem({
        files: [blobToFile(blob, buildCardFilename(displayName, blob.type))],
        text: captionFor(channel),
        url: withShareChannel(shareUrl, channel),
      })
      if (result === 'text') showToast('share.toastShareFilesUnsupported')
      if (result === 'failed') showToast('share.toastFailed')
    } finally {
      setBusy(false)
    }
  }

  /**
   * 桌面 X：window.open 必须留在 click 的同步链路里 —— 先拿窗口引用，
   * 再 await 取图与剪贴板，最后设 location，否则 await 之后的 open 会被弹窗拦截。
   */
  const handleDesktopX = async () => {
    if (!shareUrl || busy) return
    setBusy(true)
    const win = openBlankWindow()
    try {
      const blob = await getCardBlob()
      if (!blob) {
        // 同步开出来的窗口不留着发呆：能关就关，动作整体算失败
        try {
          win?.close()
        } catch {
          // 忽略
        }
        showToast('share.toastFailed')
        return
      }
      const copied = await copyImage(blob)
      if (!copied) downloadBlob(blob, buildCardFilename(displayName, blob.type))
      if (!openOrNavigate(win, buildXIntentUrl(captionFor('x')))) {
        const copiedText = await copyText(captionFor('x'))
        if (copiedText) {
          showToast('share.toastSavedAndCopiedOpenApp', { app: t('share.platformX', locale) })
        } else {
          showToast('share.toastFailed')
        }
        return
      }
      showToast(copied ? 'share.toastImageCopiedPasteInPost' : 'share.toastImageDownloadedDragIntoPost')
    } finally {
      setBusy(false)
    }
  }

  const handleCopyImage = async () => {
    if (busy) return
    setBusy(true)
    try {
      const blob = await getCardBlob()
      if (!blob) {
        showToast('share.toastFailed')
        return
      }
      if (await copyImage(blob)) {
        showToast('share.toastImageCopied')
        return
      }
      downloadBlob(blob, buildCardFilename(displayName, blob.type))
      showToast('share.toastSaved')
    } finally {
      setBusy(false)
    }
  }

  const handleCopyText = async () => {
    if (busy) return
    setBusy(true)
    try {
      showToast((await copyText(captionFor('copy'))) ? 'share.toastCopied' : 'share.toastFailed')
    } finally {
      setBusy(false)
    }
  }

  const handleSave = async () => {
    if (busy) return
    setBusy(true)
    try {
      const blob = await getCardBlob()
      if (!blob) {
        showToast('share.toastFailed')
        return
      }
      downloadBlob(blob, buildCardFilename(displayName, blob.type))
      showToast('share.toastSaved')
    } finally {
      setBusy(false)
    }
  }

  /** 桌面小红书/微信：下载图片 + 复制文案，一次点击做完 */
  const handleAppFlow = async (channel: 'xhs' | 'wx') => {
    if (busy) return
    setBusy(true)
    try {
      const blob = await getCardBlob()
      if (!blob) {
        showToast('share.toastFailed')
        return
      }
      downloadBlob(blob, buildCardFilename(displayName, blob.type))
      const copied = await copyText(captionFor(channel))
      if (copied) {
        showToast('share.toastSavedAndCopiedOpenApp', {
          app: t(channel === 'xhs' ? 'share.platformXiaohongshu' : 'share.platformWechat', locale),
        })
      } else {
        showToast('share.toastSaved')
      }
    } finally {
      setBusy(false)
    }
  }

  const ready = Boolean(shareUrl && imgLoaded)

  return (
    <div className="flex max-h-[88dvh] flex-col overflow-hidden rounded-3xl bg-white pb-[env(safe-area-inset-bottom)] shadow-2xl">
      <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
        <button type="button" onClick={onClose} aria-label={t('share.close', locale)} className="-ml-2 rounded-full p-2 hover:bg-gray-100">
          <X className="h-5 w-5 text-gray-400" />
        </button>
        <h3 className="text-base font-bold text-gray-900">{t('share.panelTitle', locale)}</h3>
        <div className="w-9" />
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
        <div
          className={`relative overflow-hidden rounded-2xl border border-gray-100 bg-gray-50 ${
            layout === 'portrait' ? 'aspect-[1080/1440]' : 'aspect-[1200/630]'
          }`}
        >
          {/* 预览直挂服务端卡片 URL，不经过 fetch；key 带 retryNonce，点重试强制重载同一条 URL */}
          <img
            key={`${cardUrl}|${retryNonce}`}
            src={cardUrl}
            alt={t('share.panelTitle', locale)}
            onLoad={() => setImgLoaded(true)}
            onError={() => setCardFailed(true)}
            className={imgLoaded && !linkFailed ? 'h-full w-full object-contain' : 'hidden'}
          />
          {!(imgLoaded && !linkFailed) ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-gray-400">
              {cardFailed || linkFailed ? (
                <>
                  <p className="text-sm">{t('share.generateFailed', locale)}</p>
                  <button
                    type="button"
                    onClick={() => setRetryNonce((n) => n + 1)}
                    className="rounded-full bg-brand px-4 py-1.5 text-xs font-medium text-white"
                  >
                    {t('share.retry', locale)}
                  </button>
                </>
              ) : (
                <>
                  <Loader2 className="h-8 w-8 animate-spin text-brand" />
                  <p className="text-sm">{t('share.generating', locale)}</p>
                </>
              )}
            </div>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">{t('share.layoutLabel', locale)}</span>
          {(['portrait', 'landscape'] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={layout === value}
              onClick={() => {
                setLayout(value)
                writePreferredLayout(value)
              }}
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                layout === value ? 'bg-brand text-white' : 'bg-gray-100 text-gray-600'
              }`}
            >
              {t(value === 'portrait' ? 'share.layoutPortrait' : 'share.layoutLandscape', locale)}
            </button>
          ))}
          <div className="ml-auto flex flex-col items-end gap-1">
            {!signedIn ? (
              // 匿名上传会被拿来传违规图：实拍一律要登录
              <button
                type="button"
                onClick={goSignIn}
                className="inline-flex items-center gap-1 text-xs font-medium text-brand"
              >
                <LogIn className="h-4 w-4" />
                {t('share.addPhotoLoginRequired', locale)}
              </button>
            ) : photoKey ? (
              <button type="button" onClick={removePhoto} className="text-xs font-medium text-gray-500 underline">
                {t('share.removePhoto', locale)}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  disabled={busy || !code}
                  onClick={() => fileRef.current?.click()}
                  className="inline-flex items-center gap-1 text-xs font-medium text-brand disabled:opacity-50"
                >
                  <Camera className="h-4 w-4" />
                  {t('share.addPhoto', locale)}
                </button>
                <span className="max-w-[180px] text-right text-[11px] leading-tight text-gray-400">
                  {t('share.photoHint', locale)}
                </span>
              </>
            )}
          </div>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={handlePhotoChange}
        />

        {captionExpanded ? (
          <div className="space-y-1">
            <label className="block space-y-1">
              <span className="text-xs text-gray-500">{t('share.captionLabel', locale)}</span>
              <textarea
                rows={3}
                value={editorValue}
                aria-label={t('share.captionLabel', locale)}
                onChange={(event) => setCaptionOverride(event.target.value)}
                className="w-full resize-none rounded-2xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-800"
              />
            </label>
            <div className="flex items-center gap-3">
              <button
                type="button"
                aria-expanded
                onClick={() => setCaptionExpanded(false)}
                className="text-xs font-medium text-gray-500"
              >
                {t('share.collapseCaption', locale)}
              </button>
              {captionOverride !== null ? (
                <button
                  type="button"
                  onClick={() => setCaptionOverride(null)}
                  className="text-xs font-medium text-brand"
                >
                  {t('share.resetCaption', locale)}
                </button>
              ) : null}
            </div>
          </div>
        ) : (
          <button
            type="button"
            aria-label={t('share.captionLabel', locale)}
            aria-expanded={false}
            onClick={() => setCaptionExpanded(true)}
            className="flex w-full items-center gap-2 rounded-2xl border border-gray-200 bg-gray-50 px-3 py-2 text-left text-sm text-gray-700"
          >
            <span className="min-w-0 flex-1 truncate">{collapsedCaption}</span>
            <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
          </button>
        )}

        {mobilePath ? (
          <button
            type="button"
            disabled={!ready}
            onClick={() => shareToSystem('sys')}
            className={`${BUTTON_BASE} text-sm w-full bg-gray-900 text-white`}
          >
            <Share2 className="h-4 w-4" />
            {t('share.shareTo', locale)}
          </button>
        ) : null}

        {/* 卡片没就绪时先出骨架占位 */}
        {!imgLoaded ? (
          <div className="grid grid-cols-3 gap-2" data-testid="share-destinations-skeleton" aria-hidden="true">
            {[0, 1, 2, 3, 4, 5].map((slot) => (
              <div key={slot} className="h-11 animate-pulse rounded-xl bg-gray-100" />
            ))}
          </div>
        ) : (
        <div
          data-testid="share-destinations"
          className={`grid gap-2 ${mobilePath ? 'grid-cols-5' : 'grid-cols-3'}`}
        >
          {mobilePath ? (
            MOBILE_DESTINATIONS.map((destination) => (
              <button
                key={destination.channel}
                type="button"
                disabled={!ready}
                onClick={() => shareToSystem(destination.channel)}
                className={`${BUTTON_BASE} w-full bg-gray-100 px-1.5 text-xs text-gray-800`}
              >
                {t(destination.labelKey, locale)}
              </button>
            ))
          ) : (
            <>
              <button
                type="button"
                disabled={!ready}
                onClick={handleDesktopX}
                className={`${BUTTON_BASE} text-sm w-full bg-gray-100 text-gray-800`}
              >
                {t('share.platformX', locale)}
              </button>
              <a
                href={
                  ready
                    ? buildRedditSubmitUrl(
                        withShareChannel(shareUrl, 'rd'),
                        t('share.redditTitle', locale)
                          .replace('{point}', displayName)
                          .replace('{anime}', cardAnimeTitle),
                      )
                    : undefined
                }
                aria-disabled={!ready}
                target="_blank"
                rel="noreferrer"
                className={`${BUTTON_BASE} text-sm w-full bg-gray-100 text-gray-800 no-underline ${ready ? '' : 'pointer-events-none opacity-50'}`}
              >
                {t('share.platformReddit', locale)}
              </a>
              <a
                href={ready ? buildLineShareUrl(withShareChannel(shareUrl, 'ln'), captionFor('ln')) : undefined}
                aria-disabled={!ready}
                target="_blank"
                rel="noreferrer"
                className={`${BUTTON_BASE} text-sm w-full bg-gray-100 text-gray-800 no-underline ${ready ? '' : 'pointer-events-none opacity-50'}`}
              >
                {t('share.platformLine', locale)}
              </a>
              <button
                type="button"
                disabled={!ready}
                onClick={() => handleAppFlow('xhs')}
                className={`${BUTTON_BASE} text-sm w-full bg-gray-100 text-gray-800`}
              >
                {t('share.platformXiaohongshu', locale)}
              </button>
              <button
                type="button"
                disabled={!ready}
                onClick={() => handleAppFlow('wx')}
                className={`${BUTTON_BASE} text-sm w-full bg-gray-100 text-gray-800`}
              >
                {t('share.platformWechat', locale)}
              </button>
              <button
                type="button"
                disabled={!ready}
                onClick={handleSave}
                className={`${BUTTON_BASE} text-sm w-full bg-brand text-white`}
              >
                <Download className="h-4 w-4" />
                {t('share.saveImage', locale)}
              </button>
            </>
          )}
        </div>
        )}

        <div>
          <button
            type="button"
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen((value) => !value)}
            className="inline-flex items-center gap-1 text-xs font-medium text-gray-500"
          >
            {t('share.more', locale)}
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          {moreOpen ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {mobilePath ? (
                <button
                  type="button"
                  disabled={!ready}
                  onClick={handleSave}
                  className={`${BUTTON_BASE} text-sm bg-gray-100 text-gray-800`}
                >
                  <Download className="h-4 w-4" />
                  {t('share.saveImage', locale)}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={!ready}
                  onClick={handleCopyImage}
                  className={`${BUTTON_BASE} text-sm bg-gray-100 text-gray-800`}
                >
                  <Copy className="h-4 w-4" />
                  {t('share.copyImage', locale)}
                </button>
              )}
              <button
                type="button"
                disabled={!shareUrl}
                onClick={handleCopyText}
                className={`${BUTTON_BASE} text-sm bg-gray-100 text-gray-800`}
              >
                {t('share.copyText', locale)}
              </button>
            </div>
          ) : null}
        </div>

        {toast ? (
          <div role="status" className="rounded-xl bg-gray-900/90 px-3 py-2 text-center text-xs text-white">
            {toast}
          </div>
        ) : null}
      </div>
    </div>
  )
}
