"use client"

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'

type WaitlistStatusResponse = { ok: true; joined: boolean } | { error: string }
type WaitlistJoinResponse = { ok: true; joined: true } | { error: string }

type ModalState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'needs_auth' }
  | { kind: 'ready'; joined: boolean }
  | { kind: 'error'; message: string }

function getErrorMessage(data: unknown): string {
  if (!data || typeof data !== 'object') return '请求失败'
  const msg = (data as { error?: unknown }).error
  return typeof msg === 'string' && msg.trim() ? msg : '请求失败'
}

function AppWaitlistModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [state, setState] = useState<ModalState>({ kind: 'idle' })
  const [joining, setJoining] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  async function loadStatus() {
    setState({ kind: 'loading' })
    const res = await fetch('/api/waitlist', { method: 'GET' })
    if (res.status === 401) {
      setState({ kind: 'needs_auth' })
      return
    }
    const data = (await res.json().catch(() => ({}))) as WaitlistStatusResponse
    if (!res.ok || 'error' in data) {
      setState({ kind: 'error', message: getErrorMessage(data) })
      return
    }
    setState({ kind: 'ready', joined: Boolean(data.joined) })
  }

  async function join() {
    setJoining(true)
    const res = await fetch('/api/waitlist', { method: 'POST' })
    if (res.status === 401) {
      setJoining(false)
      setState({ kind: 'needs_auth' })
      return
    }
    const data = (await res.json().catch(() => ({}))) as WaitlistJoinResponse
    if (!res.ok || 'error' in data) {
      setJoining(false)
      setState({ kind: 'error', message: getErrorMessage(data) })
      return
    }
    setJoining(false)
    setState({ kind: 'ready', joined: true })
  }

  useEffect(() => {
    if (!open) return
    void loadStatus()
  }, [open])

  useEffect(() => {
    if (!open) return

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  if (!open || !mounted) return null

  const title = 'SeichiGo App Waitlist'
  const description = 'App 正在开发中。加入 Waitlist，第一时间收到上线通知。'

  const modal = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4"
      onMouseDown={onClose}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-2xl bg-gray-950 text-white ring-1 ring-white/10 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-6 pt-6">
          <div className="space-y-1">
            <div className="text-lg font-bold tracking-tight">{title}</div>
            <div className="text-sm text-gray-300">{description}</div>
          </div>
          <button
            type="button"
            aria-label="关闭"
            className="rounded-full bg-white/10 px-2 py-1 text-sm text-white hover:bg-white/15"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <div className="px-6 pb-6 pt-5">
          {state.kind === 'loading' ? <div className="text-sm text-gray-300">加载中…</div> : null}

          {state.kind === 'error' ? (
            <div className="rounded-xl bg-rose-500/10 p-3 text-sm text-rose-200 ring-1 ring-rose-500/20">
              {state.message}
            </div>
          ) : null}

          {state.kind === 'needs_auth' ? (
            <div className="space-y-3">
              <div className="text-sm text-gray-300">加入队列需要登录账号。</div>
              <div className="flex flex-wrap gap-2">
                <Link
                  href="/auth/signup"
                  className="inline-flex items-center justify-center rounded-md bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600"
                >
                  注册
                </Link>
                <Link
                  href="/auth/signin"
                  className="inline-flex items-center justify-center rounded-md bg-white/10 px-4 py-2 text-sm font-semibold text-white ring-1 ring-white/10 hover:bg-white/15"
                >
                  登录
                </Link>
              </div>
            </div>
          ) : null}

          {state.kind === 'ready' ? (
            state.joined ? (
              <div className="flex items-center justify-between gap-3 rounded-xl bg-emerald-500/10 p-3 ring-1 ring-emerald-500/20">
                <div className="text-sm text-emerald-200">已加入队列</div>
                <button
                  type="button"
                  className="rounded-md bg-white/10 px-3 py-1.5 text-sm font-semibold text-white ring-1 ring-white/10 hover:bg-white/15"
                  onClick={onClose}
                >
                  关闭
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <button
                  type="button"
                  className="inline-flex w-full items-center justify-center rounded-md bg-brand-500 px-4 py-3 text-sm font-semibold text-white hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-70"
                  disabled={joining}
                  onClick={() => void join()}
                >
                  {joining ? '加入中…' : '加入 Waitlist'}
                </button>
                <div className="text-xs text-gray-400">我们会记录你当前账号的邮箱，用于上线通知。</div>
              </div>
            )
          ) : null}
        </div>
      </div>
    </div>
  )

  return createPortal(modal, document.body)
}

export default function AppWaitlistPromoCtas() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <div className="flex shrink-0 flex-col gap-4 sm:flex-row">
        <button
          type="button"
          className="group relative flex h-14 items-center gap-3 rounded-xl bg-white/5 px-6 pr-8 text-left ring-1 ring-white/10 transition-all hover:bg-white/10"
          onClick={() => setOpen(true)}
        >
          <svg className="h-7 w-7 text-white opacity-90" viewBox="0 0 24 24" fill="currentColor">
            <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-.69-.32-1.54-.32-2.19 0-1.04.56-2.15.56-3.14-.43-1.8-1.79-2.92-5.15-1.21-8.1 1.1-1.9 3.09-2.8 4.75-2.73 1.16.05 2.03.62 2.67.62.63 0 1.76-.66 3.07-.56 1.05.08 2.02.51 2.76 1.44-2.52 1.5-2.07 5.23.47 6.27-.54 1.35-1.22 2.67-2.3 4.18-.76 1.05-1.55 2.08-2.69 1.95-.76-.08-1.55-.53-2.69-.53-1.14 0-1.92.45-2.69.53-1.14.13-1.93-.9-2.69-1.95-.56-.78-1.08-1.63-1.55-2.52 1.5-2.52 3.8-2.8 5.6-1.05.65.63 1.33 1.18 2.05 1.63.72.45 1.48.83 2.28 1.13.8.3 1.63.53 2.48.68.85.15 1.73.23 2.63.23h.1z"/>
            <path d="M12.03 7.24c-.13-2.3 1.73-4.3 3.97-4.5.25 2.5-2.45 4.75-3.97 4.5z"/>
          </svg>
          <div className="flex flex-col leading-none">
            <span className="text-[10px] uppercase text-gray-400">Download on the</span>
            <span className="text-sm font-bold text-white">App Store</span>
          </div>
        </button>

        <button
          type="button"
          className="group relative flex h-14 items-center gap-3 rounded-xl bg-white/5 px-6 pr-8 text-left ring-1 ring-white/10 transition-all hover:bg-white/10"
          onClick={() => setOpen(true)}
        >
          <svg className="h-6 w-6 text-white opacity-90" viewBox="0 0 24 24" fill="currentColor">
            <path d="M3.609 1.814L13.792 12 3.61 22.186a2.048 2.048 0 01-2.02-3.12l1.64-7.066-1.64-7.066a2.048 2.048 0 012.02-3.12zM15.5 12c0 .133-.006.265-.018.396l-7.066 7.066c-.63.63-1.72.184-1.72-.707V5.245c0-.89 1.09-1.337 1.72-.707l7.066 7.066c.012.131.018.263.018.396z"/>
          </svg>
          <div className="flex flex-col leading-none">
            <span className="text-[10px] uppercase text-gray-400">Get it on</span>
            <span className="text-sm font-bold text-white">Google Play</span>
          </div>
        </button>
      </div>

      <AppWaitlistModal open={open} onClose={() => setOpen(false)} />
    </>
  )
}
