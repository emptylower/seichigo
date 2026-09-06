import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getServerAuthSession } from '@/lib/auth/session'
import { UsageMeterClient } from '@/components/billing/UsageMeterClient'
import { SubscriptionCard } from '@/components/billing/SubscriptionCard'
import { getLocale } from '@/lib/i18n/getLocale'

export const dynamic = 'force-dynamic'

const SECTIONS = [
  { href: '/plan', title: '我的巡礼计划', desc: 'AI 规划的多日巡礼行程' },
  { href: '/me/favorites', title: '我的收藏', desc: '收藏的点位与攻略' },
  { href: '/me/routebooks', title: '个人地图', desc: '手动整理的点位路书' },
  { href: '/submit', title: '投稿', desc: '分享你的巡礼攻略' },
  { href: '/me/settings', title: '设置', desc: '账号与偏好设置' },
]

export default async function MePage(props: { searchParams: Promise<{ billing?: string | string[] }> }) {
  const session = await getServerAuthSession()
  if (!session?.user?.id) redirect('/auth/signin?callbackUrl=/me')
  const locale = await getLocale()
  // 结账成功后的回跳只用来显示“正在开通”，真值一律等 webhook（设计 §2）
  const billingParam = (await props.searchParams)?.billing
  const pendingActivation = (Array.isArray(billingParam) ? billingParam[0] : billingParam) === 'success'

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-bold text-gray-900">我的</h1>
      {/* 用量表：接口缺席/未登录时 UsageMeter 返回 null，不留空节点（外层 space-y-6 不会多出间距） */}
      <UsageMeterClient size="full" locale={locale} />
      <SubscriptionCard locale={locale} pendingActivation={pendingActivation} />
      <ul className="grid gap-4 sm:grid-cols-2">
        {SECTIONS.map((section) => (
          <li key={section.href}>
            <Link
              href={section.href}
              className="block rounded-2xl border border-gray-200 bg-white p-5 transition hover:border-brand-300 hover:shadow-sm"
            >
              <p className="font-semibold text-gray-900">{section.title}</p>
              <p className="mt-1 text-sm text-gray-500">{section.desc}</p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
