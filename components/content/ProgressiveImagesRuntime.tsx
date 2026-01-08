"use client"

import { useEffect, useMemo, useState } from 'react'

type Props = {
  rootSelector?: string
}

type LightboxState = {
  src: string
  alt: string
}

function scheduleIdle(task: () => void) {
  if (typeof window === 'undefined') return
  const ric = (window as any).requestIdleCallback as undefined | ((cb: () => void) => void)
  if (typeof ric === 'function') {
    ric(task)
    return
  }
  window.setTimeout(task, 0)
}

function preloadImage(src: string, onDone: () => void) {
  try {
    const img = new Image()
    img.decoding = 'async'
    img.onload = () => onDone()
    img.onerror = () => {}
    img.src = src
  } catch {
    // Ignore preload failures.
  }
}

function upgradeToSd(img: HTMLImageElement) {
  const sd = img.getAttribute('data-seichi-sd') || ''
  if (!sd) return
  const current = img.getAttribute('src') || ''
  if (current === sd) return
  if (img.getAttribute('data-seichi-stage') === 'sd' || img.getAttribute('data-seichi-stage') === 'hd') return

  img.setAttribute('data-seichi-stage', 'sd')
  img.setAttribute('data-seichi-blur', 'true')
  img.addEventListener(
    'load',
    () => {
      if (img.getAttribute('src') !== sd) return
      img.setAttribute('data-seichi-blur', 'false')
      scheduleHd(img)
    },
    { once: true }
  )
  img.setAttribute('src', sd)
}

function scheduleHd(img: HTMLImageElement) {
  const hd = img.getAttribute('data-seichi-hd') || ''
  if (!hd) return
  if (img.getAttribute('data-seichi-stage') === 'hd') return

  scheduleIdle(() => {
    if (!img.isConnected) return
    if (img.getAttribute('data-seichi-stage') === 'hd') return
    preloadImage(hd, () => {
      if (!img.isConnected) return
      img.setAttribute('data-seichi-stage', 'hd')
      img.setAttribute('src', hd)
    })
  })
}

export default function ProgressiveImagesRuntime({ rootSelector = '[data-seichi-article-content="true"]' }: Props) {
  const [lightbox, setLightbox] = useState<LightboxState | null>(null)

  const selector = useMemo(() => rootSelector.trim(), [rootSelector])

  useEffect(() => {
    const roots = selector ? Array.from(document.querySelectorAll(selector)) : []
    if (!roots.length) return

    const images = roots.flatMap((root) => Array.from(root.querySelectorAll('img[data-seichi-full]'))) as HTMLImageElement[]
    if (!images.length) return

    const clickHandlers = new Map<HTMLImageElement, (e: MouseEvent) => void>()
    for (const img of images) {
      const full = img.getAttribute('data-seichi-full') || ''
      if (!full) continue
      const onClick = (e: MouseEvent) => {
        e.preventDefault()
        e.stopPropagation()
        setLightbox({ src: full, alt: img.alt || '' })
      }
      clickHandlers.set(img, onClick)
      img.addEventListener('click', onClick)
    }

    let observer: IntersectionObserver | null = null
    if (typeof IntersectionObserver === 'function') {
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue
            const img = entry.target as HTMLImageElement
            upgradeToSd(img)
          }
        },
        { rootMargin: '200px 0px', threshold: 0.01 }
      )
      for (const img of images) observer.observe(img)
    } else {
      for (const img of images) upgradeToSd(img)
    }

    return () => {
      for (const [img, onClick] of clickHandlers.entries()) {
        img.removeEventListener('click', onClick)
      }
      observer?.disconnect()
    }
  }, [selector])

  useEffect(() => {
    if (!lightbox) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setLightbox(null)
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.body.style.overflow = prev
    }
  }, [lightbox])

  if (!lightbox) return null
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onMouseDown={() => setLightbox(null)}
    >
      <div className="relative max-h-[92vh] max-w-[92vw]" onMouseDown={(e) => e.stopPropagation()}>
        <button
          type="button"
          aria-label="关闭图片"
          className="absolute -right-2 -top-2 rounded-full bg-white/90 px-2 py-1 text-sm text-gray-900 shadow"
          onClick={() => setLightbox(null)}
        >
          ✕
        </button>
        <img src={lightbox.src} alt={lightbox.alt} className="max-h-[92vh] max-w-[92vw] rounded-md object-contain" />
      </div>
    </div>
  )
}

