'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { Building2, CircleUser, FileText, Loader2, Map as MapIcon, Plus, X } from 'lucide-react'
import { DEFAULT_PLAN_TITLE } from '@/lib/tripPlan/repo'
import { toIntlLocale } from '@/lib/i18n/intlLocale'
import type { SupportedLocale } from '@/lib/i18n/types'
import { planText, planTextFor } from '../lib/planText'
import { useClientLocaleText } from '../hooks/useClientFormattedTime'

/** 会话列表刷新事件：plan_updated SSE 事件（标题生成等元数据变化）后由 PlanPlanner 派发 */
export const PLANS_CHANGED_EVENT = 'seichigo:plans-changed'

export type PlanSidebarPlan = { id: string; title: string; updatedAt: string }

function displayTitle(title: string, locale: SupportedLocale): string {
  const trimmed = title.trim()
  return trimmed && trimmed !== DEFAULT_PLAN_TITLE ? trimmed : planText(locale, 'sidebar.untitled')
}

function startOfLocalDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/** 列表时间标签：今天 / 昨天 / M月D日（en 走 Intl 的 `Sep 5`） */
export function formatPlanListDay(iso: string, now: Date = new Date(), locale: SupportedLocale = 'zh'): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const diffDays = Math.round((startOfLocalDay(now) - startOfLocalDay(d)) / 86_400_000)
  if (diffDays === 0) return planText(locale, 'sidebar.today')
  if (diffDays === 1) return planText(locale, 'sidebar.yesterday')
  return new Intl.DateTimeFormat(toIntlLocale(locale), { month: 'short', day: 'numeric' }).format(d)
}

/** useClientLocaleText 用的稳定引用（模块级，避免每次渲染重算） */
function planListDayForLocale(iso: string, locale: SupportedLocale): string {
  return formatPlanListDay(iso, new Date(), locale)
}

/** 列表时间标签：今天 / 昨天 / M月D日。水合安全（React #418）：标签依赖本地
 *  时区与当前时刻，首帧空串（服务端/客户端首次渲染一致），effect 后填充。 */
function PlanListDayLabel(props: { updatedAt: string; locale: SupportedLocale }) {
  const label = useClientLocaleText(props.updatedAt, planListDayForLocale, props.locale)
  return <span className="mt-0.5 block text-xs text-gray-400">{label}</span>
}

/** 站点区紧凑导航（图标 + 文字）：沉浸布局隐藏了站点 Header，这里是回到网站其它页面的出口 */
const SITE_NAV_ITEMS = [
  { href: '/map', key: 'sidebar.navMap', Icon: MapIcon },
  { href: '/', key: 'sidebar.navPosts', Icon: FileText },
  { href: '/city', key: 'sidebar.navCity', Icon: Building2 },
  { href: '/me', key: 'sidebar.navMe', Icon: CircleUser },
] as const

function SiteNavSection({ locale }: { locale: SupportedLocale }) {
  const tx = planTextFor(locale)
  return (
    <div className="border-b border-pink-100/80 px-3 pb-3 pt-4">
      <Link href="/" className="flex items-center gap-2 rounded-lg px-1 py-1 transition hover:bg-white/70">
        <Image
          src="/brand/app-logo-64.png"
          alt="SeichiGo"
          width={24}
          height={24}
          className="h-6 w-6 rounded-md bg-white object-cover"
          unoptimized
        />
        <span className="font-display text-sm font-semibold text-gray-900">SeichiGo</span>
      </Link>
      <nav aria-label={tx('sidebar.siteNav')} className="mt-2 grid grid-cols-4 gap-1">
        {SITE_NAV_ITEMS.map(({ href, key, Icon }) => (
          <Link
            key={key}
            href={href}
            className="flex flex-col items-center gap-1 rounded-lg px-1 py-1.5 text-xs text-gray-600 transition hover:bg-white hover:text-brand-600"
          >
            <Icon className="h-4 w-4" />
            {tx(key)}
          </Link>
        ))}
      </nav>
    </div>
  )
}

/**
 * 传统 AI Chat 布局的左侧会话列表：桌面（lg+）常驻 260px 侧栏，移动端由
 * 对话列标题行的菜单按钮以抽屉形式打开。任何已创建的对话都立刻出现在
 * 列表里——props 初始化挂载，PLANS_CHANGED_EVENT 触发重新拉取。
 */
export function PlanSidebar(props: {
  plans: PlanSidebarPlan[]
  currentPlanId: string
  mobileOpen: boolean
  onCloseMobile: () => void
  locale?: SupportedLocale
}) {
  const locale = props.locale ?? 'zh'
  const tx = planTextFor(locale)
  const router = useRouter()
  const [plans, setPlans] = useState(props.plans)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  // 跳转/SSR 刷新后 props 变化时同步
  useEffect(() => {
    setPlans(props.plans)
  }, [props.plans])

  // plan_updated / 标题生成后 PlanPlanner 派发事件 → 重新拉取会话列表
  useEffect(() => {
    function onChanged() {
      void (async () => {
        try {
          const res = await fetch('/api/me/plans')
          if (!res.ok) return
          const body = (await res.json()) as { plans?: PlanSidebarPlan[] }
          if (Array.isArray(body.plans)) setPlans(body.plans)
        } catch {
          // 网络抖动时保持现有列表
        }
      })()
    }
    window.addEventListener(PLANS_CHANGED_EVENT, onChanged)
    return () => window.removeEventListener(PLANS_CHANGED_EVENT, onChanged)
  }, [])

  async function createPlan() {
    if (creating) return
    setCreating(true)
    setCreateError(null)
    try {
      const res = await fetch('/api/me/plans', { method: 'POST', body: JSON.stringify({}) })
      const body = (await res.json().catch(() => null)) as { plan?: { id: string }; error?: string } | null
      if (!res.ok || !body?.plan) {
        setCreateError(body?.error ?? tx('sidebar.createFailed'))
        return
      }
      router.push(`/plan/${body.plan.id}`)
    } finally {
      setCreating(false)
    }
  }

  function handleSelect(id: string) {
    router.push(`/plan/${id}`)
    props.onCloseMobile()
  }

  const sorted = [...plans].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))

  const list = (
    <>
      <SiteNavSection locale={locale} />
      <div className="px-3 pb-2 pt-3">
        <button
          type="button"
          onClick={() => void createPlan()}
          disabled={creating}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-brand-200 bg-white px-3 py-2 text-sm font-medium text-brand-600 transition hover:bg-brand-50 disabled:opacity-60"
        >
          {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          {tx('sidebar.newChat')}
        </button>
        {createError ? <p className="mt-1.5 px-1 text-xs text-red-500">{createError}</p> : null}
      </div>
      <nav aria-label={tx('sidebar.listLabel')} className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-4">
        {sorted.map((p) => {
          const active = p.id === props.currentPlanId
          return (
            <button
              key={p.id}
              type="button"
              aria-current={active ? 'page' : undefined}
              onClick={() => handleSelect(p.id)}
              className={`block w-full rounded-xl px-3 py-2.5 text-left transition ${
                active ? 'bg-white shadow-sm ring-1 ring-brand-100' : 'hover:bg-white/70'
              }`}
            >
              <span className={`block truncate text-sm ${active ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>
                {displayTitle(p.title, locale)}
              </span>
              <PlanListDayLabel updatedAt={p.updatedAt} locale={locale} />
            </button>
          )
        })}
        {sorted.length === 0 ? <p className="px-3 py-2 text-xs text-gray-400">{tx('sidebar.empty')}</p> : null}
      </nav>
    </>
  )

  return (
    <>
      {/* 桌面常驻侧栏 */}
      <aside className="hidden w-[260px] shrink-0 flex-col border-r border-pink-100 bg-pink-50/40 lg:flex">{list}</aside>

      {/* 移动端抽屉：标题行菜单按钮打开，遮罩点击关闭 */}
      {props.mobileOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-gray-900/30" onClick={props.onCloseMobile} aria-hidden="true" />
          <aside className="absolute inset-y-0 left-0 flex w-72 flex-col border-r border-pink-100 bg-pink-50 shadow-xl">
            <div className="flex justify-end px-2 pt-2">
              <button
                type="button"
                aria-label={tx('sidebar.closeList')}
                onClick={props.onCloseMobile}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full text-gray-500 transition hover:bg-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {list}
          </aside>
        </div>
      ) : null}
    </>
  )
}
