'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import Avatar from '@/components/shared/Avatar'
import type { SiteLocale } from './SiteShell'
import { prefixPath } from './prefixPath'

type SessionUser = {
  name?: string | null
  email?: string | null
  image?: string | null
  isAdmin?: boolean | null
}

type Session = {
  user?: SessionUser | null
} | null

type Props = {
  locale: SiteLocale
  labels: {
    admin: string
    favorites: string
    signout: string
    signin: string
    signup: string
    user: string
  }
}

export default function HeaderAuthControls({ locale, labels }: Props) {
  const [session, setSession] = useState<Session>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()

    async function fetchSessionOnce(): Promise<Session> {
      const r = await fetch('/api/auth/session', {
        credentials: 'include',
        cache: 'no-store',
        signal: controller.signal,
      })
      if (!r.ok) return null
      return (await r.json()) as Session
    }

    async function loadSession() {
      try {
        const first = await fetchSessionOnce()
        if (cancelled) return
        if (first?.user) {
          setSession(first)
          setLoaded(true)
          return
        }

        // After a sign-in redirect, some browsers can briefly race cookie
        // persistence. A single retry avoids pinning the header in anon mode.
        await new Promise((resolve) => window.setTimeout(resolve, 300))
        const second = await fetchSessionOnce()
        if (cancelled) return
        setSession(second)
        setLoaded(true)
      } catch {
        if (cancelled) return
        setSession(null)
        setLoaded(true)
      }
    }

    loadSession()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [])

  const userLabel = useMemo(() => {
    const v = String(session?.user?.name || session?.user?.email || labels.user).trim()
    return v || labels.user
  }, [labels.user, session?.user?.email, session?.user?.name])

  const showAuthed = Boolean(session?.user)
  const showAnon = !showAuthed

  // Keep a stable initial render (avoid hydration mismatch) by rendering the
  // anonymous controls until session is loaded.
  if (!loaded) {
    return (
      <div className="flex items-center gap-2">
        <Link href="/auth/signin" className="text-gray-700 hover:text-brand-600">{labels.signin}</Link>
        <Link href="/auth/signup" className="btn-primary">{labels.signup}</Link>
      </div>
    )
  }

  return (
    <>
      {session?.user?.isAdmin ? <Link href={prefixPath('/admin/panel', locale)} className="hover:text-brand-600">{labels.admin}</Link> : null}
      {showAuthed ? (
        <details className="group relative">
          <summary
            className="flex h-11 w-11 cursor-pointer list-none items-center justify-center rounded-2xl border border-pink-200/80 bg-gradient-to-b from-white to-pink-50/80 p-1.5 text-gray-700 shadow-[0_1px_2px_rgba(15,23,42,0.08)] transition duration-200 hover:-translate-y-0.5 hover:border-pink-300 hover:shadow-[0_8px_18px_rgba(236,72,153,0.18)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-300 group-open:border-pink-300 group-open:shadow-[0_8px_18px_rgba(236,72,153,0.18)] [&::-webkit-details-marker]:hidden"
            aria-label={userLabel}
          >
            <Avatar
              src={session?.user?.image}
              name={userLabel}
              size={34}
            />
            <span className="sr-only">{userLabel}</span>
          </summary>
          <div className="absolute right-0 mt-2 w-44 rounded-2xl border border-pink-100 bg-white/95 p-1.5 shadow-xl ring-1 ring-black/5 backdrop-blur-sm">
            <Link href={prefixPath('/me/settings', locale)} className="block rounded-xl px-3 py-2 text-sm text-gray-700 transition hover:bg-pink-50 hover:text-pink-700">
              用户中心
            </Link>
            <a href={prefixPath('/me/favorites', locale)} className="block rounded-xl px-3 py-2 text-sm text-gray-700 transition hover:bg-pink-50 hover:text-pink-700">
              {labels.favorites}
            </a>
            <a href="/api/auth/signout" className="block rounded-xl px-3 py-2 text-sm text-gray-700 transition hover:bg-pink-50 hover:text-pink-700">
              {labels.signout}
            </a>
          </div>
        </details>
      ) : null}
      {showAnon ? (
        <div className="flex items-center gap-2">
          <Link href="/auth/signin" className="text-gray-700 hover:text-brand-600">{labels.signin}</Link>
          <Link href="/auth/signup" className="btn-primary">{labels.signup}</Link>
        </div>
      ) : null}
    </>
  )
}
