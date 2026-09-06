'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Home, Loader2, SendHorizontal } from 'lucide-react'
import LoginModal from '@/components/auth/LoginModal'
import type { SiteLocale } from '@/components/layout/SiteShell'
import { t } from '@/lib/i18n'
import { PENDING_DRAFT_KEY } from '@/app/(authed)/plan/[id]/hooks/usePendingDraft'

const TITLE_MAX_LENGTH = 30

/** 与 components/LanguageSwitcher.tsx 的 setLocaleCookie 同参数 */
function setLocaleCookie(locale: SiteLocale) {
  document.cookie = `NEXT_LOCALE=${locale}; path=/; max-age=31536000; SameSite=Lax`
}

/** 示例 chip 与首页输入框同一组文案，不另写一份免得两边漂移 */
const EXAMPLE_KEYS = ['composerExample1', 'composerExample2', 'composerExample3'] as const

/**
 * 规划师起始页：游客也能进来输入（不做重定向），真正发送第一条消息时才弹登录。
 * 发送 = 建一个计划 + 把这条消息交接到 sessionStorage，计划页挂载后自动发出。
 */
export default function PlanStartClient({
  initialDraft,
  signedIn,
  locale = 'zh',
  syncLocaleCookie = false,
}: {
  initialDraft: string
  signedIn: boolean
  /** 低-6：首页跳过来时带的 `?locale=`（zh 不带，缺省即中文） */
  locale?: SiteLocale
  /** ?locale= 显式给出时为 true：挂载后写一次 NEXT_LOCALE cookie */
  syncLocaleCookie?: boolean
}) {
  const router = useRouter()
  // 首页带 `?locale=` 跳进来时把语言落到 cookie：创建后跳转的 /plan/<id>
  // （非前缀路由）才能继续用同一种语言渲染
  useEffect(() => {
    if (!syncLocaleCookie) return
    try {
      setLocaleCookie(locale)
    } catch {
      /* 禁用 cookie 的浏览器：起始页本身仍是正确语言，不影响本次创建 */
    }
  }, [syncLocaleCookie, locale])
  const examples = EXAMPLE_KEYS.map((key) => t(`pages.home.v2.${key}`, locale))
  const [text, setText] = useState(initialDraft)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loginOpen, setLoginOpen] = useState(false)
  // 中-1：登录态是本地 state——弹窗里登录成功后就是登录态了，
  // 服务端传来的初值只是首帧起点，不能让第二次发送又弹一遍窗
  const [authed, setAuthed] = useState(signedIn)

  async function createPlanAndGo() {
    const message = text.trim()
    if (!message || busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/me/plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: message.slice(0, TITLE_MAX_LENGTH) }),
      })
      const body = (await res.json().catch(() => null)) as { plan?: { id?: string }; error?: string } | null
      // 服务端所有失败（含 429 每日上限）都带 error 文案，直接透传
      const planId = res.ok ? body?.plan?.id : null
      if (typeof planId !== 'string' || !planId) {
        setError(body?.error ?? t('pages.planStart.errorCreate', locale))
        setBusy(false)
        return
      }
      // 交接第一条消息：计划页挂载后按 usePendingDraft 自动发出
      try {
        window.sessionStorage.setItem(PENDING_DRAFT_KEY, JSON.stringify({ text: message, createdAt: Date.now() }))
      } catch {
        // sessionStorage 不可用时退化为「进去了但要自己再发一次」
      }
      // 中-8：成功后**不**放开 busy——路由跳转有一段时间，这期间再点一次
      // 就会多建一个空计划
      router.push(`/plan/${planId}`)
    } catch {
      setError(t('pages.planStart.errorNetwork', locale))
      setBusy(false)
    }
  }

  function handleSend() {
    if (!text.trim() || busy) return
    if (!authed) {
      setLoginOpen(true)
      return
    }
    void createPlanAndGo()
  }

  return (
    <div data-layout-wide="true" data-layout-immersive="true" className="flex min-h-dvh flex-col bg-white">
      <div className="sticky top-0 z-10 border-b border-gray-100 bg-white">
        <div className="mx-auto flex w-full max-w-3xl items-center gap-2 px-3 py-3">
          <h1 className="flex-1 truncate text-sm font-semibold text-gray-900">{t('pages.planStart.title', locale)}</h1>
          <Link
            href="/"
            aria-label={t('pages.planStart.backHome', locale)}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-gray-400 transition hover:bg-pink-50 hover:text-brand-600"
          >
            <Home className="h-4 w-4" />
          </Link>
        </div>
      </div>

      <div className="mx-auto w-full max-w-3xl flex-1 space-y-4 px-4 pb-8 pt-6">
        <div className="max-w-[85%] rounded-2xl rounded-tl-sm bg-pink-50 px-4 py-3 text-sm leading-relaxed text-gray-700">
          {t('pages.planStart.greeting', locale)}
        </div>

        <div className="flex flex-wrap gap-2">
          {examples.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => setText(example)}
              className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-600 transition-colors hover:border-brand-300 hover:text-brand-600"
            >
              {example}
            </button>
          ))}
        </div>

        {error ? <div className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-600">{error}</div> : null}

        <div className="flex items-end gap-2 rounded-2xl border border-gray-200 bg-white p-2 focus-within:border-brand-300">
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              // 中-2：输入法组词期间的回车是「上屏」，不是「发送」
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault()
                handleSend()
              }
            }}
            rows={3}
            placeholder={t('pages.planStart.placeholder', locale)}
            className="max-h-40 min-h-16 flex-1 resize-none rounded-xl px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none"
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={busy}
            aria-label={t('pages.planStart.send', locale)}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white transition-colors hover:bg-brand-700 disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <SendHorizontal className="h-4 w-4" />}
          </button>
        </div>
      </div>

      <LoginModal
        locale={locale}
        open={loginOpen}
        onClose={() => setLoginOpen(false)}
        onSuccess={() => {
          setAuthed(true)
          setLoginOpen(false)
          void createPlanAndGo()
        }}
      />
    </div>
  )
}
