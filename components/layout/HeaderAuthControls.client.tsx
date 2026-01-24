'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import type { SiteLocale } from './SiteShell'
import { prefixPath } from './prefixPath'

type SessionUser = {
  name?: string | null
  email?: string | null
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
    fetch('/api/auth/session', { credentials: 'include' })
      .then(async (r) => {
        if (!r.ok) return null
        return (await r.json()) as Session
      })
      .then((data) => {
        if (cancelled) return
        setSession(data)
        setLoaded(true)
      })
      .catch(() => {
        if (cancelled) return
        setSession(null)
        setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const userLabel = useMemo(() => {
    const v = String(session?.user?.name || session?.user?.email || labels.user).trim()
    return v || labels.user
  }, [labels.user, session?.user?.email, session?.user?.name])

  const avatarLetter = useMemo(() => userLabel.slice(0, 1).toUpperCase(), [userLabel])

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
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-pink-100 text-xs font-semibold text-pink-700">
              {avatarLetter}
            </span>
            <span className="max-w-28 truncate">{userLabel}</span>
          </summary>
          <div className="absolute right-0 mt-2 w-40 rounded-xl border border-gray-200 bg-white p-1 shadow-lg">
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
