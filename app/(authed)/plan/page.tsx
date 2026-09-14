import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { prefixPath } from '@/components/layout/prefixPath'
import { getLocale } from '@/lib/i18n/getLocale'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

/**
 * /plan 不再有独立的会话列表页，也不再创建默认计划：无论是否登录，一律 307
 * 到当前语言的 /plan/start 新对话首页（发第一句才创建计划）。
 * DEFAULT_PLAN_TITLE 与 POST /api/me/plans 创建接口保留（起始页仍在用）。
 */
export default async function PlanIndexPage() {
  redirect(prefixPath('/plan/start', await getLocale()))
}
