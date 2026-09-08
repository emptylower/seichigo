'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSession } from 'next-auth/react'
import { Camera, ChevronRight, Copy, Download, Loader2, Share2, X } from 'lucide-react'
import { t } from '@/lib/i18n'
import type { SupportedLocale } from '@/lib/i18n/types'
import { SHARE_PHOTO_MAX_BYTES, type PointContextResponse, type ShareCardLayout, type ShareChannel } from '@/lib/share/types'
import PointShareCard, { type PointShareCardInput } from '@/components/share/PointShareCard'
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
  fetchPointContext,
  openBlankWindow,
  openOrNavigate,
  readPreferredLayout,
  shareViaSystem,
  transcodeToJpeg,
  uploadShareAssets,
  writePreferredLayout,
} from '@/components/share/shareClient'

export type PointSharePanelProps = {
  pointId: string
  bangumiId: number
  pointName: string
  animeTitle: string
  cityName: string
  episode: string | null
  scene: string | null
  animeImage: string
  locale?: SupportedLocale
  onClose?: () => void
}

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50'

/** canvas 与 <img> 原生能吃的格式；其余（HEIC 等）先转 JPEG */
const NATIVE_PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

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
  episode,
  scene,
  animeImage,
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
  // context 还没回来（含失败落定）都不算 settled：卡片必须等它落定再画，
  // 否则会先出一版无地址卡片，再被带地址版本覆盖（上传也会跟着错版）
  const [contextSettled, setContextSettled] = useState(false)
  const [shareUrl, setShareUrl] = useState<string>('')
  const [code, setCode] = useState<string>('')
  const [cardBlob, setCardBlob] = useState<Blob | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [photo, setPhoto] = useState<File | null>(null)
  const [photoObjectUrl, setPhotoObjectUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [linkFailed, setLinkFailed] = useState(false)
  const [retryNonce, setRetryNonce] = useState(0)
  const [toast, setToast] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [captionOverride, setCaptionOverride] = useState<string | null>(null)
  const [captionExpanded, setCaptionExpanded] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const uploadedRef = useRef(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { status: sessionStatus } = useSession()

  // 版式变了就换一条短链：短链上记录了 layout，OG 图尺寸要对得上
  useEffect(() => {
    let cancelled = false
    setShareUrl('')
    setCode('')
    setLinkFailed(false)
    uploadedRef.current = false
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

  // 与建短链并行：地址/说明/去前缀点位名。失败也置 settled，卡片按无地址画
  useEffect(() => {
    let cancelled = false
    setContext(null)
    setContextSettled(false)
    fetchPointContext(pointId, locale).then((result) => {
      if (cancelled) return
      setContext(result)
      setContextSettled(true)
    })
    return () => {
      cancelled = true
    }
  }, [pointId, locale, retryNonce])

  const previewUrlRef = useRef<string | null>(null)
  const photoObjectUrlRef = useRef<string | null>(null)
  useEffect(() => {
    previewUrlRef.current = previewUrl
  }, [previewUrl])
  useEffect(() => {
    photoObjectUrlRef.current = photoObjectUrl
  }, [photoObjectUrl])
  // 只在卸载时 revoke：previewUrl/photoObjectUrl 变化时另一个可能还在被卡片渲染器用着
  useEffect(() => {
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
      if (photoObjectUrlRef.current) URL.revokeObjectURL(photoObjectUrlRef.current)
    }
  }, [])

  const displayName = context?.displayName?.trim() || pointName
  const cardAnimeTitle = context?.animeTitle?.trim() || animeTitle

  const cardInput: PointShareCardInput | null = useMemo(() => {
    if (!shareUrl || !contextSettled) return null
    return {
      layout,
      locale,
      pointName: displayName,
      animeTitle: cardAnimeTitle,
      episode,
      scene,
      address: context?.address ?? null,
      note: context?.note ?? null,
      geo: context?.geo ?? null,
      inJapan: Boolean(context?.inJapan),
      animeImage,
      photoObjectUrl,
      shareUrl,
      // 扫码进站的算「存图」渠道：二维码画带 c=save 的短链
      qrUrl: withShareChannel(shareUrl, 'save'),
    }
  }, [
    shareUrl,
    contextSettled,
    layout,
    locale,
    displayName,
    cardAnimeTitle,
    episode,
    scene,
    context,
    animeImage,
    photoObjectUrl,
  ])

  const handleRendered = useCallback(
    (blob: Blob) => {
      setFailed(false)
      setCardBlob(blob)
      setPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return URL.createObjectURL(blob)
      })
      // 登录用户静默上传一次：401/429/503 都返回 null，匿名分享照常
      if (code && !uploadedRef.current && sessionStatus === 'authenticated') {
        uploadedRef.current = true
        void uploadShareAssets(code, blob, photo)
      }
    },
    [code, photo, sessionStatus],
  )

  const handleRenderError = useCallback(() => setFailed(true), [])

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

  const captionFor = useCallback(
    (channel: ShareChannel) => {
      const generated = buildShareCaption(t('share.captionTemplate', locale), {
        anime: cardAnimeTitle,
        point: displayName,
        address: captionAddress,
        url: shareUrl ? withShareChannel(shareUrl, channel) : '',
      })
      if (captionOverride === null) return generated
      return retargetCaptionChannel(captionOverride, shareUrl, channel)
    },
    [locale, cardAnimeTitle, displayName, captionAddress, shareUrl, captionOverride],
  )

  const copyCaption = captionFor('copy')
  const collapsedCaption =
    copyCaption.length > CAPTION_COLLAPSED_MAX
      ? `${copyCaption.slice(0, CAPTION_COLLAPSED_MAX)}…`
      : copyCaption

  const cardFile = useMemo(
    () => (cardBlob ? blobToFile(cardBlob, buildCardFilename(displayName)) : null),
    [cardBlob, displayName],
  )
  // 手机/桌面只看 navigator.canShare({ files })，不看 UA
  const mobilePath = useMemo(() => (cardFile ? canShareFiles([cardFile]) : false), [cardFile])

  const handlePhotoChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    if (file.size > SHARE_PHOTO_MAX_BYTES) {
      showToast('share.toastPhotoTooLarge')
      if (fileRef.current) fileRef.current.value = ''
      return
    }
    let next = file
    if (!NATIVE_PHOTO_TYPES.has(file.type)) {
      const transcoded = await transcodeToJpeg(file)
      if (!transcoded) {
        showToast('share.toastPhotoUnsupported')
        if (fileRef.current) fileRef.current.value = ''
        return
      }
      next = new File([transcoded], `${file.name.replace(/\.[^.]+$/, '') || 'photo'}.jpg`, {
        type: 'image/jpeg',
      })
    }
    setPhoto(next)
    setPhotoObjectUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return URL.createObjectURL(next)
    })
    uploadedRef.current = false
  }

  const removePhoto = () => {
    setPhoto(null)
    setPhotoObjectUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return null
    })
    if (fileRef.current) fileRef.current.value = ''
    uploadedRef.current = false
  }

  const shareToSystem = async (channel: ShareChannel) => {
    if (!cardFile || !shareUrl || busy) return
    setBusy(true)
    try {
      const result = await shareViaSystem({
        files: [cardFile],
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
   * 再 await 剪贴板，最后设 location，否则 await 之后的 open 会被弹窗拦截。
   */
  const handleDesktopX = async () => {
    if (!cardBlob || !shareUrl || busy) return
    setBusy(true)
    const win = openBlankWindow()
    try {
      const copied = await copyImage(cardBlob)
      if (!copied) downloadBlob(cardBlob, buildCardFilename(displayName))
      if (!openOrNavigate(win, buildXIntentUrl(captionFor('x')))) {
        showToast('share.toastFailed')
        return
      }
      showToast(copied ? 'share.toastImageCopiedPasteInPost' : 'share.toastImageDownloadedDragIntoPost')
    } finally {
      setBusy(false)
    }
  }

  const handleCopyImage = async () => {
    if (!cardBlob || busy) return
    setBusy(true)
    try {
      if (await copyImage(cardBlob)) {
        showToast('share.toastImageCopied')
        return
      }
      // 剪贴板不可用时降级为下载，别让操作无声失败
      downloadBlob(cardBlob, buildCardFilename(displayName))
      showToast('share.toastSaved')
    } finally {
      setBusy(false)
    }
  }

  const handleCopyText = async () => {
    if (busy) return
    setBusy(true)
    try {
      showToast((await copyText(copyCaption)) ? 'share.toastCopied' : 'share.toastFailed')
    } finally {
      setBusy(false)
    }
  }

  const handleSave = () => {
    if (!cardBlob) return
    downloadBlob(cardBlob, buildCardFilename(displayName))
    showToast('share.toastSaved')
  }

  /** 桌面小红书/微信：下载图片 + 复制文案，一次点击做完 */
  const handleAppFlow = async (channel: 'xhs' | 'wx') => {
    if (!cardBlob || busy) return
    setBusy(true)
    try {
      downloadBlob(cardBlob, buildCardFilename(displayName))
      await copyText(captionFor(channel))
      showToast('share.toastSavedAndCopiedOpenApp', {
        app: t(channel === 'xhs' ? 'share.platformXiaohongshu' : 'share.platformWechat', locale),
      })
    } finally {
      setBusy(false)
    }
  }

  const ready = Boolean(cardBlob && shareUrl)

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
          {previewUrl ? (
            <img src={previewUrl} alt={t('share.panelTitle', locale)} className="h-full w-full object-contain" />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-gray-400">
              {failed || linkFailed ? (
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
          )}
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
            {photo ? (
              <button type="button" onClick={removePhoto} className="text-xs font-medium text-gray-500 underline">
                {t('share.removePhoto', locale)}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="inline-flex items-center gap-1 text-xs font-medium text-brand"
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
          <label className="block space-y-1">
            <span className="text-xs text-gray-500">{t('share.captionLabel', locale)}</span>
            <textarea
              rows={3}
              value={copyCaption}
              aria-label={t('share.captionLabel', locale)}
              onChange={(event) => setCaptionOverride(event.target.value)}
              className="w-full resize-none rounded-2xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-800"
            />
          </label>
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
            className={`${BUTTON_BASE} w-full bg-gray-900 text-white`}
          >
            <Share2 className="h-4 w-4" />
            {t('share.shareTo', locale)}
          </button>
        ) : null}

        <div className="grid grid-cols-3 gap-2">
          {mobilePath ? (
            MOBILE_DESTINATIONS.map((destination) => (
              <button
                key={destination.channel}
                type="button"
                disabled={!ready}
                onClick={() => shareToSystem(destination.channel)}
                className={`${BUTTON_BASE} w-full bg-gray-100 text-gray-800`}
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
                className={`${BUTTON_BASE} w-full bg-gray-100 text-gray-800`}
              >
                {t('share.platformX', locale)}
              </button>
              <a
                href={
                  shareUrl
                    ? buildRedditSubmitUrl(
                        withShareChannel(shareUrl, 'rd'),
                        t('share.redditTitle', locale)
                          .replace('{point}', displayName)
                          .replace('{anime}', cardAnimeTitle),
                      )
                    : undefined
                }
                aria-disabled={!shareUrl}
                target="_blank"
                rel="noreferrer"
                className={`${BUTTON_BASE} w-full bg-gray-100 text-gray-800 no-underline ${shareUrl ? '' : 'pointer-events-none opacity-50'}`}
              >
                {t('share.platformReddit', locale)}
              </a>
              <a
                href={shareUrl ? buildLineShareUrl(withShareChannel(shareUrl, 'ln'), captionFor('ln')) : undefined}
                aria-disabled={!shareUrl}
                target="_blank"
                rel="noreferrer"
                className={`${BUTTON_BASE} w-full bg-gray-100 text-gray-800 no-underline ${shareUrl ? '' : 'pointer-events-none opacity-50'}`}
              >
                {t('share.platformLine', locale)}
              </a>
              <button
                type="button"
                disabled={!ready}
                onClick={() => handleAppFlow('xhs')}
                className={`${BUTTON_BASE} w-full bg-gray-100 text-gray-800`}
              >
                {t('share.platformXiaohongshu', locale)}
              </button>
              <button
                type="button"
                disabled={!ready}
                onClick={() => handleAppFlow('wx')}
                className={`${BUTTON_BASE} w-full bg-gray-100 text-gray-800`}
              >
                {t('share.platformWechat', locale)}
              </button>
              <button
                type="button"
                disabled={!ready}
                onClick={handleSave}
                className={`${BUTTON_BASE} w-full bg-brand text-white`}
              >
                <Download className="h-4 w-4" />
                {t('share.saveImage', locale)}
              </button>
            </>
          )}
        </div>

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
                  className={`${BUTTON_BASE} bg-gray-100 text-gray-800`}
                >
                  <Download className="h-4 w-4" />
                  {t('share.saveImage', locale)}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={!ready}
                  onClick={handleCopyImage}
                  className={`${BUTTON_BASE} bg-gray-100 text-gray-800`}
                >
                  <Copy className="h-4 w-4" />
                  {t('share.copyImage', locale)}
                </button>
              )}
              <button
                type="button"
                disabled={!shareUrl}
                onClick={handleCopyText}
                className={`${BUTTON_BASE} bg-gray-100 text-gray-800`}
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

      {cardInput ? (
        <PointShareCard input={cardInput} onRendered={handleRendered} onError={handleRenderError} />
      ) : null}
    </div>
  )
}
