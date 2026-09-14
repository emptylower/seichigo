import type { Metadata } from 'next'
import PlanStartPageContent from '@/components/plan/PlanStartPageContent'
import { firstQueryValue } from '@/components/plan/planStartQuery'
import { buildPlanStartMetadata } from '@/lib/seo/planStart'

export const dynamic = 'force-dynamic'

export function generateMetadata(): Metadata {
  return buildPlanStartMetadata('ja')
}

/**
 * 规划师起始页（日文入口 `/ja/plan/start`）：公开路由，语言固定日文，
 * 路径上的 `?locale=` 一律忽略（query 不覆盖路径）。父布局已套公共壳，
 * 这里不再套第二层。
 */
export default async function PlanStartJaPage(props: {
  searchParams: Promise<{ draft?: string | string[] }>
}) {
  const searchParams = await props.searchParams
  return <PlanStartPageContent locale="ja" draft={firstQueryValue(searchParams?.draft)} />
}
