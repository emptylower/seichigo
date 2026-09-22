import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { t } from '@/lib/i18n'
import type { SupportedLocale } from '@/lib/i18n/types'

const { headersMock } = vi.hoisted(() => ({ headersMock: vi.fn() }))

vi.mock('next/headers', () => ({ headers: headersMock }))
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }))
vi.mock('next-auth/react', () => ({ signIn: vi.fn() }))
vi.mock('@/lib/auth/session', () => ({
  getServerAuthSession: async () => ({ user: { id: 'user-1', email: 'user@example.com' } }),
}))
vi.mock('@/lib/db/prisma', () => ({
  prisma: { user: { findUnique: async () => ({ passwordHash: null }) } },
}))

import SignInPage, { generateMetadata as signinMetadata } from '@/app/auth/signin/page'
import SignUpPage, { generateMetadata as signupMetadata } from '@/app/auth/signup/page'
import SetPasswordPage, { generateMetadata as setPasswordMetadata } from '@/app/auth/set-password/page'
import { getAuthLocale } from '@/app/auth/getAuthLocale'

describe('auth page locale', () => {
  beforeEach(() => {
    headersMock.mockReset()
    headersMock.mockResolvedValue(new Headers())
  })

  it('renders the English signin title from the middleware header', async () => {
    headersMock.mockResolvedValue(new Headers({ 'x-seichigo-locale': 'en', cookie: 'NEXT_LOCALE=ja' }))
    render(await SignInPage())
    expect(screen.getByRole('heading', { name: t('auth.signin.title', 'en') })).toHaveTextContent('Sign in')
  })

  it('renders the Japanese signup title from the middleware header', async () => {
    headersMock.mockResolvedValue(new Headers({ 'x-seichigo-locale': 'ja' }))
    render(await SignUpPage())
    expect(screen.getByRole('heading', { name: t('auth.signup.title', 'ja') })).toHaveTextContent('新規登録')
  })

  it.each([
    { locale: 'en', title: 'Set a password' },
    { locale: 'ja', title: 'パスワード設定' },
  ])('renders the $locale set-password title', async ({ locale, title }) => {
    headersMock.mockResolvedValue(new Headers({ 'x-seichigo-locale': locale }))
    render(await SetPasswordPage())
    expect(screen.getByRole('heading', { name: title })).toBeInTheDocument()
  })

  it.each<SupportedLocale>(['zh', 'en', 'ja'])('localizes metadata for %s and retains canonical paths', async (locale) => {
    headersMock.mockResolvedValue(new Headers({ 'x-seichigo-locale': locale }))
    expect(await signinMetadata()).toEqual({
      title: t('auth.signin.title', locale),
      description: t('auth.signin.description', locale),
      alternates: { canonical: '/auth/signin' },
    })
    expect(await setPasswordMetadata()).toEqual({
      title: t('auth.setPassword.title', locale),
      description: t('auth.setPassword.description', locale),
      alternates: { canonical: '/auth/set-password' },
    })
    expect(await signupMetadata()).toEqual({
      title: t('auth.signup.title', locale),
      description: t('auth.signup.description', locale),
      alternates: { canonical: '/auth/signup' },
    })
  })

  it.each<{ headers: Record<string, string>; locale: SupportedLocale }>([
    { headers: { 'x-seichigo-pathname': '/ja/auth/signin', cookie: 'NEXT_LOCALE=en', 'accept-language': 'en' }, locale: 'ja' },
    { headers: { cookie: 'NEXT_LOCALE=ja', 'accept-language': 'en' }, locale: 'ja' },
    { headers: { 'accept-language': 'en-US,en;q=0.9' }, locale: 'en' },
    { headers: { 'x-seichigo-locale': 'invalid', 'accept-language': 'ja' }, locale: 'ja' },
    { headers: {}, locale: 'zh' },
  ])('falls back to the shared request resolver: $locale ($headers)', async ({ headers, locale }) => {
    headersMock.mockResolvedValue(new Headers(headers))
    expect(await getAuthLocale()).toBe(locale)
  })
})
