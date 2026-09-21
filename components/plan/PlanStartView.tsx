'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import LoginModal from '@/components/auth/LoginModal'
import type { SiteLocale } from '@/components/layout/SiteShell'
import { t, tArray } from '@/lib/i18n'
import { track } from '@/lib/analytics/track'
import { notifyUsageChanged, useUsage } from '@/hooks/useUsage'
import { PlanShell } from '@/components/plan/PlanShell'
import { PlanComposer } from '@/app/(authed)/plan/[id]/components/PlanComposer'
import { PLANS_CHANGED_EVENT, type PlanSidebarPlan } from '@/app/(authed)/plan/[id]/components/PlanSidebar'
import { PENDING_DRAFT_KEY } from '@/app/(authed)/plan/[id]/hooks/usePendingDraft'

const TITLE_MAX_LENGTH = 30

/** 与 components/LanguageSwitcher.tsx 的 setLocaleCookie 同参数 */
function setLocaleCookie(locale: SiteLocale) {
  document.cookie = `NEXT_LOCALE=${locale}; path=/; max-age=31536000; SameSite=Lax`
}

type Suggestion = { emoji: string; text: string }

/**
 * 规划师新对话首页（三语起始页共用客户端）：与 /plan/[id] 同一外壳
 * （PlanShell + PlanSidebar），主区是居中的大标题、输入框与四条建议行。
 * 游客也能进来输入（不做重定向），真正发送第一条消息时才弹登录。
 * 发送 = 建一个计划 + 把这条消息交接到 sessionStorage，计划页挂载后自动发出。
 */
export default function PlanStartView({
  plans,
  initialDraft,
  signedIn,
  locale = 'zh',
  syncLocaleCookie = false,
}: {
  /** 侧栏最近对话列表（服务端 listPlans 注入）；游客传 [] */
  plans: PlanSidebarPlan[]
  initialDraft: string
  signedIn: boolean
  /** 语言由入口路径绑定：/plan/start=zh、/en/plan/start=en、/ja/plan/start=ja */
  locale?: SiteLocale
  /** 三个入口都传 true：挂载后写一次 NEXT_LOCALE cookie */
  syncLocaleCookie?: boolean
}) {
  const router = useRouter()
  // 本月 agent 用量（设计 §4）：与对话页同一来源；游客无 sg_auth 标记时
  // useUsage 不发请求直接归 null，侧栏此时走游客引导不渲染用量区
  const { usage } = useUsage()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  // 把路径语言落到 cookie：创建后跳转的 /plan/<id>（无前缀路由）才能继续用
  // 同一种语言渲染
  useEffect(() => {
    if (!syncLocaleCookie) return
    try {
      setLocaleCookie(locale)
    } catch {
      /* 禁用 cookie 的浏览器：起始页本身仍是正确语言，不影响本次创建 */
    }
  }, [syncLocaleCookie, locale])
  const suggestions = tArray<Suggestion>('pages.planStart.suggestions', locale)
  const [text, setText] = useState(initialDraft)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loginOpen, setLoginOpen] = useState(false)
  // 登录弹窗有两个入口：发送第一条消息（登录成功后继续建计划）与侧栏游客
  // 引导的登录按钮（只登录，不附带发送意图）——分开记录，否则从侧栏登录
  // 成功后会误建一个内容为空的计划
  const [loginIntent, setLoginIntent] = useState<'send' | 'sidebar'>('send')
  // 中-1：登录态是本地 state——弹窗里登录成功后就是登录态了，
  // 服务端传来的初值只是首帧起点，不能让第二次发送又弹一遍窗
  const [authed, setAuthed] = useState(signedIn)
  // 这次要发的内容是不是点建议行来的（埋点 suggestion 参数）；用户手打改动后复位
  const suggestionUsedRef = useRef(false)

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
      // 起始页的「提交一次规划请求」只在计划真的建出来后计：
      // 429/网络错等失败路径不算发起（F8）；计划页自动发出那一下不再重复计
      track('plan_start', { entry: 'start_page', suggestion: suggestionUsedRef.current })
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
      track('plan_login_required', { entry: 'start_page' })
      setLoginIntent('send')
      setLoginOpen(true)
      return
    }
    void createPlanAndGo()
  }

  /** 建议行：填入输入框并聚焦、光标移到末尾——不发送；再点另一行则替换 */
  function applySuggestion(next: string) {
    suggestionUsedRef.current = true
    setText(next)
    // 等受控值落到 DOM 后再聚焦定位（受控组件在渲染后才更新 value）
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (!el) return
      el.focus()
      const len = el.value.length
      el.setSelectionRange(len, len)
    })
  }

  return (
    <PlanShell
      plans={plans}
      currentPlanId={null}
      usage={usage}
      locale={locale}
      variant="start"
      guest={!authed}
      onRequireLogin={() => {
        setLoginIntent('sidebar')
        setLoginOpen(true)
      }}
    >
      {({ mobileMenuButton }) => (
        <>
          <div className="relative min-w-0 flex-1 overflow-y-auto">
            <div className="flex min-h-full flex-col">
              {/* 标题行：与对话页同款；这里的 H1 是全页唯一 h1（sitelinks 入口名约束） */}
              <div className="sticky top-0 z-10 border-b border-gray-100 bg-white">
                <div className="mx-auto flex w-full max-w-3xl items-center gap-2 px-3 py-3">
                  {mobileMenuButton}
                  <h1 className="flex-1 truncate text-[13px] text-gray-500">{t('pages.planStart.title', locale)}</h1>
                </div>
              </div>

              {/* 内容列：标题 + 输入框 + 建议行整体垂直居中 */}
              <div className="mx-auto my-auto w-full max-w-3xl px-4 py-10">
                <div className="flex flex-col items-center gap-3 text-center">
                  <h2 className="text-2xl font-semibold text-gray-900">{t('pages.planStart.headline', locale)}</h2>
                  <p className="max-w-xl text-sm leading-relaxed text-gray-500">{t('pages.planStart.intro', locale)}</p>
                </div>

                {error ? <div className="mt-4 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-600">{error}</div> : null}

                <div className="mt-5">
                  <PlanComposer
                    value={text}
                    onChange={(next) => {
                      // 手打改动后就不算建议行发起的了
                      suggestionUsedRef.current = false
                      setText(next)
                    }}
                    onSend={handleSend}
                    busy={busy}
                    answering={false}
                    stopRequested={busy}
                    onStop={() => {}}
                    budgetNotice={null}
                    textareaRef={textareaRef}
                    locale={locale}
                    variant="inline"
                  />
                </div>

                <div className="mt-2 flex flex-col">
                  {suggestions.map((suggestion) => (
                    <button
                      key={suggestion.text}
                      type="button"
                      onClick={() => applySuggestion(suggestion.text)}
                      className="flex items-center gap-3 rounded-[10px] px-3 py-2.5 text-left text-sm text-gray-700 hover:bg-pink-50"
                    >
                      <span className="text-base" aria-hidden>
                        {suggestion.emoji}
                      </span>
                      <span>{suggestion.text}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <LoginModal
            locale={locale}
            open={loginOpen}
            onClose={() => setLoginOpen(false)}
            onSuccess={() => {
              setAuthed(true)
              setLoginOpen(false)
              // 侧栏最近对话与用量都靠事件刷新：登录成功后立即派发，让刚
              // 转成登录态的侧栏拉到列表（PLANS_CHANGED）与本月用量
              window.dispatchEvent(new Event(PLANS_CHANGED_EVENT))
              notifyUsageChanged()
              // 只有「发送第一条消息」入口登录成功后才继续建计划；侧栏
              // 游客引导的登录只完成登录本身
              if (loginIntent === 'send') void createPlanAndGo()
            }}
          />
        </>
      )}
    </PlanShell>
  )
}
