'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Camera, Copy, Download, Loader2, Share2, X } from 'lucide-react'
import { t } from '@/lib/i18n'
import type { SupportedLocale } from '@/lib/i18n/types'
import type { ShareCardLayout, ShareChannel } from '@/lib/share/types'
import PointShareCard, { type PointShareCardInput } from '@/components/share/PointShareCard'
import {
  buildLineShareUrl,
  buildRedditSubmitUrl,
  buildShareCaption,
  buildXIntentUrl,
  withShareChannel,
} from '@/components/share/shareText'
import {
  blobToFile,
  copyImage,
  copyText,
  createShareLink,
  downloadBlob,
  readPreferredLayout,
  shareViaSystem,
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
  const [layout, setLayout] = useState<ShareCardLayout>(() => readPreferredLayout())
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
  const uploadedRef = useRef(false)
  const fileRef = useRef<HTMLInputElement>(null)

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

  const cardInput: PointShareCardInput | null = useMemo(() => {
    if (!shareUrl) return null
    return {
      layout,
      locale,
      pointName,
      animeTitle,
      cityName,
      episode,
      scene,
      animeImage,
      photoObjectUrl,
      shareUrl,
      // 扫码进站的算「存图」渠道：二维码画带 c=save 的短链
      qrUrl: withShareChannel(shareUrl, 'save'),
    }
  }, [shareUrl, layout, locale, pointName, animeTitle, cityName, episode, scene, animeImage, photoObjectUrl])

  const handleRendered = useCallback(
    (blob: Blob) => {
      setFailed(false)
      setCardBlob(blob)
      setPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return URL.createObjectURL(blob)
      })
      // 登录用户静默上传一次：401/429/503 都返回 null，匿名分享照常
      if (code && !uploadedRef.current) {
        uploadedRef.current = true
        void uploadShareAssets(code, blob, photo)
      }
    },
    [code, photo],
  )

  const handleRenderError = useCallback(() => setFailed(true), [])

  const showToast = useCallback((key: string) => {
    setToast(t(key, locale))
    setTimeout(() => setToast(null), 2200)
  }, [locale])

  const captionFor = useCallback(
    (channel: ShareChannel) =>
      buildShareCaption(t('share.captionTemplate', locale), {
        anime: animeTitle,
        point: pointName,
        city: cityName,
        url: shareUrl ? withShareChannel(shareUrl, channel) : '',
      }),
    [locale, animeTitle, pointName, cityName, shareUrl],
  )

  const copyCaption = captionFor('copy')

  const handlePhotoChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    setPhoto(file)
    setPhotoObjectUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return URL.createObjectURL(file)
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

  const handleSystemShare = async () => {
    if (!cardBlob) return
    const file = blobToFile(cardBlob, `seichigo-${pointName}.jpg`)
    const result = await shareViaSystem({
      files: [file],
      text: captionFor('sys'),
      url: withShareChannel(shareUrl, 'sys'),
    })
    if (result === 'text') showToast('share.toastShareFilesUnsupported')
    if (result === 'failed') showToast('share.toastFailed')
  }

  const handleCopyImage = async () => {
    if (!cardBlob) return
    showToast((await copyImage(cardBlob)) ? 'share.toastImageCopied' : 'share.toastFailed')
  }

  const handleCopyText = async () => {
    showToast((await copyText(copyCaption)) ? 'share.toastCopied' : 'share.toastFailed')
  }

  const handleSave = (channel: ShareChannel = 'save') => {
    if (!cardBlob) return
    downloadBlob(cardBlob, `seichigo-${pointName}-${Date.now()}.jpg`)
    if (channel === 'save') showToast('share.toastSaved')
  }

  const handleAppFlow = async (channel: 'xhs' | 'wx') => {
    handleSave(channel)
    await copyText(captionFor(channel))
    showToast('share.toastPasteInApp')
  }

  const ready = Boolean(cardBlob && shareUrl)

  return (
    <div className="flex max-h-[88vh] flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
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
          <div className="ml-auto">
            {photo ? (
              <button type="button" onClick={removePhoto} className="text-xs font-medium text-gray-500 underline">
                {t('share.removePhoto', locale)}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="inline-flex items-center gap-1 text-xs font-medium text-brand"
              >
                <Camera className="h-4 w-4" />
                {t('share.addPhoto', locale)}
              </button>
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

        <label className="block space-y-1">
          <span className="text-xs text-gray-500">{t('share.captionLabel', locale)}</span>
          <textarea
            readOnly
            rows={3}
            value={copyCaption}
            aria-label={t('share.captionLabel', locale)}
            className="w-full resize-none rounded-2xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-800"
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <button type="button" disabled={!ready} onClick={handleSystemShare} className={`${BUTTON_BASE} bg-gray-900 text-white sm:hidden`}>
            <Share2 className="h-4 w-4" />
            {t('share.systemShare', locale)}
          </button>
          <button type="button" disabled={!ready} onClick={handleCopyImage} className={`${BUTTON_BASE} hidden bg-gray-900 text-white sm:inline-flex`}>
            <Copy className="h-4 w-4" />
            {t('share.copyImage', locale)}
          </button>
          <button type="button" disabled={!shareUrl} onClick={handleCopyText} className={`${BUTTON_BASE} bg-gray-100 text-gray-800`}>
            {t('share.copyText', locale)}
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <a
            href={shareUrl ? buildXIntentUrl(captionFor('x')) : undefined}
            target="_blank"
            rel="noreferrer"
            className={`${BUTTON_BASE} bg-gray-100 text-gray-800 no-underline`}
          >
            {t('share.platformX', locale)}
          </a>
          <a
            href={shareUrl ? buildRedditSubmitUrl(withShareChannel(shareUrl, 'rd'), `${pointName}｜${animeTitle}`) : undefined}
            target="_blank"
            rel="noreferrer"
            className={`${BUTTON_BASE} bg-gray-100 text-gray-800 no-underline`}
          >
            {t('share.platformReddit', locale)}
          </a>
          <a
            href={shareUrl ? buildLineShareUrl(withShareChannel(shareUrl, 'ln'), captionFor('ln')) : undefined}
            target="_blank"
            rel="noreferrer"
            className={`${BUTTON_BASE} bg-gray-100 text-gray-800 no-underline`}
          >
            {t('share.platformLine', locale)}
          </a>
          <button type="button" disabled={!ready} onClick={() => handleAppFlow('xhs')} className={`${BUTTON_BASE} bg-gray-100 text-gray-800`}>
            {t('share.platformXiaohongshu', locale)}
          </button>
          <button type="button" disabled={!ready} onClick={() => handleAppFlow('wx')} className={`${BUTTON_BASE} bg-gray-100 text-gray-800`}>
            {t('share.platformWechat', locale)}
          </button>
          <button type="button" disabled={!ready} onClick={() => handleSave()} className={`${BUTTON_BASE} bg-brand text-white`}>
            <Download className="h-4 w-4" />
            {t('share.saveImage', locale)}
          </button>
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
