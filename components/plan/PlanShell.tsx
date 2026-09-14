'use client'

import { useState, type ReactNode } from 'react'
import { Menu } from 'lucide-react'
import type { UsageView } from '@/hooks/useUsage'
import type { SupportedLocale } from '@/lib/i18n/types'
import { PlanSidebar, type PlanSidebarPlan } from '@/app/(authed)/plan/[id]/components/PlanSidebar'
import { planTextFor } from '@/app/(authed)/plan/[id]/lib/planText'

/** 主区标题行拿到的插槽：手机端抽屉按钮（桌面端由 lg:hidden 隐藏） */
export type PlanShellMainSlot = {
  mobileMenuButton: ReactNode
}

/**
 * 规划师页面外壳：/plan/[id] 对话页与 /plan/start 起始页共用（纯结构抽取，
 * 对话页行为不变）。负责整页容器（data-layout-wide/-immersive 隐藏站点页头
 * 页脚）、左侧 PlanSidebar（桌面常驻 / 移动端抽屉）与抽屉开合状态；主区内容
 * 由 children render prop 决定，标题行里的手机端抽屉按钮在这里渲染后交给
 * 主区摆放。
 */
export function PlanShell(props: {
  plans: PlanSidebarPlan[]
  /** 当前对话 id；起始页没有当前对话，传 null */
  currentPlanId: string | null
  /** 本月 agent 用量：null/undefined 时侧栏用量区整块不渲染 */
  usage?: UsageView | null
  locale?: SupportedLocale
  /** start=起始页（侧栏「新对话」选中态）；plan=对话页（默认） */
  variant?: 'start' | 'plan'
  /** 游客态：侧栏列表/用量区换成登录引导 */
  guest?: boolean
  /** 游客点侧栏登录按钮时的回调（由主区打开 LoginModal） */
  onRequireLogin?: () => void
  children: (slot: PlanShellMainSlot) => ReactNode
}) {
  const locale = props.locale ?? 'zh'
  const tx = planTextFor(locale)
  // 移动端会话列表抽屉（桌面常驻侧栏不涉及）
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  const mobileMenuButton = (
    <button
      type="button"
      aria-label={tx('sidebar.openList')}
      onClick={() => setMobileNavOpen(true)}
      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-gray-600 transition hover:bg-pink-50 hover:text-brand-600 lg:hidden"
    >
      <Menu className="h-4 w-4" />
    </button>
  )

  return (
    <div data-layout-wide="true" data-layout-immersive="true" className="flex h-dvh">
      <PlanSidebar
        plans={props.plans}
        currentPlanId={props.currentPlanId}
        mobileOpen={mobileNavOpen}
        onCloseMobile={() => setMobileNavOpen(false)}
        usage={props.usage}
        locale={locale}
        variant={props.variant}
        guest={props.guest}
        onRequireLogin={props.onRequireLogin}
      />
      {props.children({ mobileMenuButton })}
    </div>
  )
}
