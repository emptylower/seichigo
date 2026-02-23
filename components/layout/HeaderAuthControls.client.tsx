'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
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
  layout?: 'inline' | 'stack'
  labels: {
    admin: string
    favorites: string
    signout: string
    signin: string
    signup: string
    user: string
  }
}

export default function HeaderAuthControls({ locale, layout = 'inline', labels }: Props) {
  const { data: sessionData, status } = useSession()
  const session = sessionData as Session
  const loaded = status !== 'loading'
  const userCenterLabel = locale === 'en' ? 'Account Center' : locale === 'ja' ? 'ユーザーセンター' : '用户中心'
  const myMapsLabel = locale === 'en' ? 'My Maps' : locale === 'ja' ? 'マイマップ' : '我的地图'

  const userLabel = useMemo(() => {
    const v = String(session?.user?.name || session?.user?.email || labels.user).trim()
    return v || labels.user
  }, [labels.user, session?.user?.email, session?.user?.name])

  const showAuthed = Boolean(session?.user)
  const showAnon = !showAuthed

  const anonControls = layout === 'stack' ? (
    <div className="grid gap-2">
      <Link
        href="/auth/signin"
        prefetch={false}
        className="inline-flex h-11 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 hover:text-brand-600"
      >
        {labels.signin}
      </Link>
      <Link href="/auth/signup" prefetch={false} className="inline-flex h-11 items-center justify-center rounded-lg bg-brand-500 px-3 text-sm font-semibold text-white hover:bg-brand-600">
        {labels.signup}
      </Link>
    </div>
  ) : (
    <div className="flex items-center gap-2">
      <Link href="/auth/signin" prefetch={false} className="text-gray-700 hover:text-brand-600">{labels.signin}</Link>
      <Link href="/auth/signup" prefetch={false} className="btn-primary">{labels.signup}</Link>
    </div>
  )

  // Keep a stable initial render (avoid hydration mismatch) by rendering the
  // anonymous controls until session is loaded.
  if (!loaded) {
    return anonControls
  }

  if (layout === 'stack') {
    return (
      <div className="grid gap-2.5 text-sm">
        {session?.user?.isAdmin ? (
          <Link
            href={prefixPath('/admin/panel', locale)}
            prefetch={false}
            className="inline-flex h-11 items-center rounded-lg border border-slate-200 px-3 font-medium text-slate-700 hover:bg-slate-50 hover:text-brand-600"
          >
            {labels.admin}
          </Link>
        ) : null}

        {showAuthed ? (
          <>
            <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <Avatar src={session?.user?.image} name={userLabel} size={32} />
              <div className="min-w-0">
                <div className="line-clamp-1 text-sm font-medium text-slate-800">{userLabel}</div>
              </div>
            </div>
            <Link
              href={prefixPath('/me/settings', locale)}
              prefetch={false}
              className="inline-flex h-11 items-center rounded-lg border border-slate-200 px-3 font-medium text-slate-700 hover:bg-slate-50 hover:text-brand-600"
            >
              {userCenterLabel}
            </Link>
            <a
              href={prefixPath('/me/favorites', locale)}
              className="inline-flex h-11 items-center rounded-lg border border-slate-200 px-3 font-medium text-slate-700 hover:bg-slate-50 hover:text-brand-600"
            >
              {labels.favorites}
            </a>
            <a
              href={prefixPath('/me/routebooks', locale)}
              className="inline-flex h-11 items-center rounded-lg border border-slate-200 px-3 font-medium text-slate-700 hover:bg-slate-50 hover:text-brand-600"
            >
              {myMapsLabel}
            </a>
            <a
              href="/api/auth/signout"
              className="inline-flex h-11 items-center rounded-lg border border-slate-200 px-3 font-medium text-slate-700 hover:bg-slate-50 hover:text-brand-600"
            >
              {labels.signout}
            </a>
          </>
        ) : null}

        {showAnon ? anonControls : null}
      </div>
    )
  }

  return (
    <>
      {showAuthed ? (
        <details className="group relative">
          <summary
            className="flex cursor-pointer list-none items-center justify-center rounded-full text-gray-700 transition duration-200 hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-300/70 focus-visible:ring-offset-2 focus-visible:ring-offset-white [&::-webkit-details-marker]:hidden"
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
            {session?.user?.isAdmin ? (
              <Link href={prefixPath('/admin/panel', locale)} prefetch={false} className="block rounded-xl px-3 py-2 text-sm text-gray-700 transition hover:bg-pink-50 hover:text-pink-700">
                {labels.admin}
              </Link>
            ) : null}
            <Link href={prefixPath('/me/settings', locale)} prefetch={false} className="block rounded-xl px-3 py-2 text-sm text-gray-700 transition hover:bg-pink-50 hover:text-pink-700">
              {userCenterLabel}
            </Link>
            <a href={prefixPath('/me/favorites', locale)} className="block rounded-xl px-3 py-2 text-sm text-gray-700 transition hover:bg-pink-50 hover:text-pink-700">
              {labels.favorites}
            </a>
            <a href={prefixPath('/me/routebooks', locale)} className="block rounded-xl px-3 py-2 text-sm text-gray-700 transition hover:bg-pink-50 hover:text-pink-700">
              {myMapsLabel}
            </a>
            <a href="/api/auth/signout" className="block rounded-xl px-3 py-2 text-sm text-gray-700 transition hover:bg-pink-50 hover:text-pink-700">
              {labels.signout}
            </a>
          </div>
        </details>
      ) : null}
      {showAnon ? (
        <div className="flex items-center gap-2">
          <Link href="/auth/signin" prefetch={false} className="text-gray-700 hover:text-brand-600">{labels.signin}</Link>
          <Link href="/auth/signup" prefetch={false} className="btn-primary">{labels.signup}</Link>
        </div>
      ) : null}
    </>
  )
}
