"use client"

import { useEffect, useMemo, useState } from 'react'
import { usePathname } from 'next/navigation'

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

function isNearViewport(el: Element, marginPx: number): boolean {
  try {
    const rect = (el as HTMLElement).getBoundingClientRect?.()
    if (!rect) return false
    const top = rect.top
    const bottom = rect.bottom
    return bottom >= -marginPx && top <= window.innerHeight + marginPx
  } catch {
    return false
  }
}

function upgradeToSd(img: HTMLImageElement) {
  const sd = img.getAttribute('data-seichi-sd') || ''
  if (!sd) return
  const current = img.getAttribute('src') || ''

  if (img.getAttribute('data-seichi-stage') === 'hd') return

  const stage = img.getAttribute('data-seichi-stage')
  const blurred = img.getAttribute('data-seichi-blur')

  if ((current === sd || stage === 'sd') && blurred === 'true') {
    if (img.complete && img.naturalWidth > 0) {
      img.setAttribute('data-seichi-stage', 'sd')
      img.setAttribute('data-seichi-blur', 'false')
      scheduleHd(img)
    }
    return
  }

  if (current === sd) return
  if (stage === 'sd') return

  img.setAttribute('data-seichi-stage', 'sd')
  img.setAttribute('data-seichi-blur', 'true')
  img.setAttribute('src', sd)

  if (img.complete && img.naturalWidth > 0) {
    img.setAttribute('data-seichi-blur', 'false')
    scheduleHd(img)
    return
  }

  img.addEventListener(
    'load',
    () => {
      if (img.getAttribute('src') !== sd) return
      img.setAttribute('data-seichi-blur', 'false')
      scheduleHd(img)
    },
    { once: true }
  )
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
  const pathname = usePathname()

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

    const scanNearViewport = () => {
      for (const img of images) {
        if (!img.isConnected) continue
        if (img.getAttribute('data-seichi-stage')) continue
        if (!isNearViewport(img, 250)) continue
        upgradeToSd(img)
      }
    }

    let scanTimer: number | null = null
    const requestScan = () => {
      if (scanTimer != null) return
      scanTimer = window.setTimeout(() => {
        scanTimer = null
        scanNearViewport()
      }, 80)
    }

    window.addEventListener('scroll', requestScan, { passive: true })
    window.addEventListener('resize', requestScan)

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
    }

    scheduleIdle(() => requestScan())

    return () => {
      window.removeEventListener('scroll', requestScan)
      window.removeEventListener('resize', requestScan)
      if (scanTimer != null) window.clearTimeout(scanTimer)
      for (const [img, onClick] of clickHandlers.entries()) {
        img.removeEventListener('click', onClick)
      }
      observer?.disconnect()
    }
  }, [selector, pathname])

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

