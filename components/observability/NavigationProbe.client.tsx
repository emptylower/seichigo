'use client'

import { useEffect, useMemo, useRef } from 'react'
import { usePathname } from 'next/navigation'
import * as Sentry from '@sentry/nextjs'

export type NavOutcome = 'success' | 'stall' | 'repeat_click'
export type NavSurface = 'resources-card-actions' | 'generic-link' | (string & {})

export type NavProbeEvent = {
  from_path: string
  to_path: string
  surface: NavSurface
  inside_summary: boolean
  details_open: boolean
  session_sampled: boolean
}

type NavEventName = 'nav_click' | 'nav_success' | 'nav_stall' | 'nav_repeat_click'

type PendingNav = NavProbeEvent & {
  id: number
  started_at: number
  stall_timer: number
  hard_timer: number
}

const DEFAULT_SAMPLE_RATE = 0.1
const DEFAULT_STALL_MS = 1200
const HARD_TIMEOUT_MS = 5000

function normalizePathname(pathname: string): string {
  const trimmed = String(pathname || '').trim()
  if (!trimmed) return '/'
  if (trimmed === '/') return '/'
  const noSlashTail = trimmed.replace(/\/+$/, '')
  return noSlashTail || '/'
}

function parseSampleRate(raw: string | undefined): number {
  const n = Number(raw)
  if (!Number.isFinite(n)) return DEFAULT_SAMPLE_RATE
  if (n < 0) return 0
  if (n > 1) return 1
  return n
}

function parseStallMs(raw: string | undefined): number {
  const n = Number(raw)
  if (!Number.isFinite(n)) return DEFAULT_STALL_MS
  if (n < 100) return DEFAULT_STALL_MS
  return Math.round(n)
}

function resolveSurface(anchor: HTMLAnchorElement): NavSurface {
  const fromSelf = anchor.getAttribute('data-nav-surface')
  if (fromSelf) return fromSelf as NavSurface
  const fromAncestor = anchor.closest('[data-nav-surface]')?.getAttribute('data-nav-surface')
  if (fromAncestor) return fromAncestor as NavSurface
  return 'generic-link'
}

function toInternalPath(anchor: HTMLAnchorElement): string | null {
  const rawHref = String(anchor.getAttribute('href') || '').trim()
  if (!rawHref) return null
  if (rawHref.startsWith('#')) return null
  if (rawHref.startsWith('mailto:') || rawHref.startsWith('tel:') || rawHref.startsWith('javascript:')) return null
  if (anchor.hasAttribute('download')) return null
  if (anchor.target && anchor.target !== '_self') return null

  let url: URL
  try {
    url = new URL(anchor.href, window.location.href)
  } catch {
    return null
  }

  if (url.origin !== window.location.origin) return null

  const nextPath = normalizePathname(url.pathname)
  const currentPath = normalizePathname(window.location.pathname)
  if (nextPath === currentPath) return null
  return nextPath
}

function captureNavEvent(name: NavEventName, payload: NavProbeEvent, options?: { durationMs?: number; force?: boolean }) {
  const force = Boolean(options?.force)
  if (!force && !payload.session_sampled) return

  Sentry.captureEvent({
    message: name,
    level: 'info',
    tags: {
      nav_event: name,
      nav_surface: payload.surface,
    },
    extra: {
      ...payload,
      ...(typeof options?.durationMs === 'number' ? { duration_ms: options.durationMs } : {}),
      hard_timeout_ms: HARD_TIMEOUT_MS,
    },
  })
}

export default function NavigationProbe() {
  const pathname = usePathname()
  const currentPath = useMemo(() => normalizePathname(pathname || '/'), [pathname])
  const sampleRate = useMemo(() => parseSampleRate(process.env.NEXT_PUBLIC_NAV_PROBE_SAMPLE_RATE), [])
  const stallThresholdMs = useMemo(() => parseStallMs(process.env.NEXT_PUBLIC_NAV_STALL_MS), [])

  const sessionSampledRef = useRef<boolean>(Math.random() < sampleRate)
  const pendingRef = useRef<Map<number, PendingNav>>(new Map())
  const lastClickRef = useRef<{ to_path: string; at: number } | null>(null)
  const seqRef = useRef(0)

  useEffect(() => {
    const clearPending = (id: number) => {
      const pending = pendingRef.current.get(id)
      if (!pending) return
      window.clearTimeout(pending.stall_timer)
      window.clearTimeout(pending.hard_timer)
      pendingRef.current.delete(id)
    }

    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented) return
      if (event.button !== 0) return
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return

      const target = event.target instanceof Element ? event.target : null
      if (!target) return

      const anchor = target.closest('a[href]') as HTMLAnchorElement | null
      if (!anchor) return

      const toPath = toInternalPath(anchor)
      if (!toPath) return

      const summary = anchor.closest('summary')
      const details = anchor.closest('details') as HTMLDetailsElement | null
      const fromPath = normalizePathname(window.location.pathname)

      const payload: NavProbeEvent = {
        from_path: fromPath,
        to_path: toPath,
        surface: resolveSurface(anchor),
        inside_summary: Boolean(summary),
        details_open: Boolean(details?.open),
        session_sampled: sessionSampledRef.current,
      }

      const now = performance.now()
      const last = lastClickRef.current
      if (last && last.to_path === payload.to_path && now - last.at <= stallThresholdMs) {
        captureNavEvent('nav_repeat_click', payload, {
          durationMs: Math.round(now - last.at),
          force: true,
        })
      }
      lastClickRef.current = { to_path: payload.to_path, at: now }

      captureNavEvent('nav_click', payload)

      const id = ++seqRef.current
      const stallTimer = window.setTimeout(() => {
        const pending = pendingRef.current.get(id)
        if (!pending) return
        captureNavEvent('nav_stall', pending, {
          durationMs: Math.round(performance.now() - pending.started_at),
          force: true,
        })
      }, stallThresholdMs)

      const hardTimer = window.setTimeout(() => {
        clearPending(id)
      }, HARD_TIMEOUT_MS)

      pendingRef.current.set(id, {
        ...payload,
        id,
        started_at: now,
        stall_timer: stallTimer,
        hard_timer: hardTimer,
      })
    }

    document.addEventListener('click', onClick, true)
    return () => {
      document.removeEventListener('click', onClick, true)
      for (const id of pendingRef.current.keys()) clearPending(id)
    }
  }, [stallThresholdMs])

  useEffect(() => {
    const now = performance.now()
    const doneIds: number[] = []

    for (const pending of pendingRef.current.values()) {
      if (pending.to_path !== currentPath) continue

      captureNavEvent('nav_success', pending, {
        durationMs: Math.round(now - pending.started_at),
      })
      doneIds.push(pending.id)
    }

    for (const id of doneIds) {
      const pending = pendingRef.current.get(id)
      if (!pending) continue
      window.clearTimeout(pending.stall_timer)
      window.clearTimeout(pending.hard_timer)
      pendingRef.current.delete(id)
    }
  }, [currentPath])

  return null
}
