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
        <details className="relative">
          <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md border px-2 py-1 text-gray-700 hover:bg-gray-50">
            <Avatar
              src={session?.user?.image}
              name={userLabel}
              size={32}
            />
          </summary>
          <div className="absolute right-0 mt-2 w-40 rounded-xl border border-gray-200 bg-white p-1 shadow-lg">
            <Link href={prefixPath('/me/settings', locale)} className="block rounded-lg px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
              用户中心
            </Link>
            <a href={prefixPath('/me/favorites', locale)} className="block rounded-lg px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
              {labels.favorites}
            </a>
            <a href="/api/auth/signout" className="block rounded-lg px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
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
