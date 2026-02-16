'use client'

import { useCallback, useMemo, useState } from 'react'

type ShareLocale = 'zh' | 'en' | 'ja'

type Props = {
  url: string
  title: string
  locale: ShareLocale
  className?: string
  tag?: string
}

type ShareLabels = {
  share: string
  copied: string
  shared: string
  instagramFallback: string
  instagramManual: string
}

const LABELS: Record<ShareLocale, ShareLabels> = {
  zh: {
    share: '分享',
    copied: '已复制，可粘贴到 Instagram',
    shared: '已调起系统分享',
    instagramFallback: 'Instagram',
    instagramManual: '无法自动复制，请手动复制链接后分享到 Instagram',
  },
  en: {
    share: 'Share',
    copied: 'Copied. Paste it into Instagram',
    shared: 'Opened system share sheet',
    instagramFallback: 'Instagram',
    instagramManual: 'Could not copy automatically. Please copy the link and share to Instagram',
  },
  ja: {
    share: 'シェア',
    copied: 'コピーしました。Instagram に貼り付けてください',
    shared: '共有シートを開きました',
    instagramFallback: 'Instagram',
    instagramManual: '自動コピーできませんでした。リンクをコピーして Instagram に共有してください',
  },
}

function normalizeTag(tag: string): string {
  return String(tag || '').trim().replace(/^#/, '') || 'Seichigo'
}

function buildTwitterShareUrl(url: string, title: string, tag: string): string {
  const params = new URLSearchParams()
  params.set('url', url)
  params.set('text', title)
  params.set('hashtags', tag)
  return `https://twitter.com/intent/tweet?${params.toString()}`
}

function buildRedditShareUrl(url: string, title: string, tag: string): string {
  const params = new URLSearchParams()
  params.set('url', url)
  params.set('title', `[${tag}] ${title}`)
  return `https://www.reddit.com/submit?${params.toString()}`
}

function buildInstagramText(title: string, tag: string): string {
  return `${title}\n#${tag}`
}

export default function ArticleShareButtons({ url, title, locale, className, tag = 'Seichigo' }: Props) {
  const labels = LABELS[locale]
  const normalizedTag = useMemo(() => normalizeTag(tag), [tag])
  const normalizedUrl = useMemo(() => String(url || '').trim(), [url])
  const normalizedTitle = useMemo(() => String(title || '').trim() || 'Seichigo', [title])

  const twitterUrl = useMemo(
    () => buildTwitterShareUrl(normalizedUrl, normalizedTitle, normalizedTag),
    [normalizedTag, normalizedTitle, normalizedUrl]
  )
  const redditUrl = useMemo(
    () => buildRedditShareUrl(normalizedUrl, normalizedTitle, normalizedTag),
    [normalizedTag, normalizedTitle, normalizedUrl]
  )
  const instagramText = useMemo(
    () => buildInstagramText(normalizedTitle, normalizedTag),
    [normalizedTag, normalizedTitle]
  )

  const [statusText, setStatusText] = useState('')

  const onInstagramClick = useCallback(async () => {
    const shareText = `${instagramText}\n${normalizedUrl}`
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
        await navigator.share({
          title: normalizedTitle,
          text: instagramText,
          url: normalizedUrl,
        })
        setStatusText(labels.shared)
        return
      }
    } catch {
      // Continue with clipboard fallback.
    }

    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareText)
        setStatusText(labels.copied)
      } else {
        setStatusText(labels.instagramManual)
      }
    } catch {
      setStatusText(labels.instagramManual)
    }

    if (typeof window !== 'undefined') {
      window.open('https://www.instagram.com/', '_blank', 'noopener,noreferrer')
    }
  }, [instagramText, labels.copied, labels.instagramManual, labels.shared, normalizedTitle, normalizedUrl])

  return (
    <div className={className || 'flex flex-wrap items-center gap-2'}>
      <span className="text-xs font-medium uppercase tracking-wide text-gray-500">{labels.share}</span>
      <a
        href={twitterUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center justify-center rounded-md border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-700 transition hover:border-sky-300 hover:bg-sky-100"
        aria-label="Share to Twitter"
      >
        Twitter
      </a>
      <a
        href={redditUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center justify-center rounded-md border border-orange-200 bg-orange-50 px-3 py-1.5 text-xs font-semibold text-orange-700 transition hover:border-orange-300 hover:bg-orange-100"
        aria-label="Share to Reddit"
      >
        Reddit
      </a>
      <button
        type="button"
        onClick={onInstagramClick}
        className="inline-flex items-center justify-center rounded-md border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:border-rose-300 hover:bg-rose-100"
        aria-label="Share to Instagram"
      >
        {labels.instagramFallback}
      </button>
      <span className="text-xs text-gray-500">#{normalizedTag}</span>
      {statusText ? <span className="w-full text-xs text-gray-500 sm:w-auto">{statusText}</span> : null}
    </div>
  )
}
