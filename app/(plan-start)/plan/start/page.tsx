import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import PlanStartPageContent from '@/components/plan/PlanStartPageContent'
import { buildPlanStartMetadata } from '@/lib/seo/planStart'
import { firstQueryValue } from '@/components/plan/planStartQuery'
import { parseStartLocale } from './locale'

export const dynamic = 'force-dynamic'

export function generateMetadata(): Metadata {
  return buildPlanStartMetadata('zh')
}

/**
 * 规划师起始页（中文入口 `/plan/start`）：公开路由，游客可进，发送时才弹登录。
 * 语言固定中文，不再按 Cookie/Accept-Language 解析。旧协议 `?locale=en|ja` 在
 * 解析 searchParams 之后、读会话之前 307 到对应语言路径；draft 保留第一项的
 * 解码原值重新编码一次（不 trim 不截断），并消费掉 locale 参数。
 */
export default async function PlanStartPage(props: {
  searchParams: Promise<{ draft?: string | string[]; locale?: string | string[] }>
}) {
  const searchParams = await props.searchParams
  const draft = firstQueryValue(searchParams?.draft)
  const target = parseStartLocale(searchParams?.locale)
  if (target && target !== 'zh') {
    redirect(draft ? `/${target}/plan/start?draft=${encodeURIComponent(draft)}` : `/${target}/plan/start`)
  }
  return <PlanStartPageContent locale="zh" draft={draft} />
}
