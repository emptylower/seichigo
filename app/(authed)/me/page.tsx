import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getServerAuthSession } from '@/lib/auth/session'
import { UsageMeterClient } from '@/components/billing/UsageMeterClient'
import { SubscriptionCard } from '@/components/billing/SubscriptionCard'
import { ProfileTierHeader } from '@/components/billing/ProfileTierHeader'
import { getLocale } from '@/lib/i18n/getLocale'
import { t } from '@/lib/i18n'

export const dynamic = 'force-dynamic'

const SECTION_KEYS = [
  { href: '/plan', key: 'plans' },
  { href: '/me/favorites', key: 'favorites' },
  { href: '/me/routebooks', key: 'routebooks' },
  { href: '/submit', key: 'submit' },
  { href: '/me/settings', key: 'settings' },
] as const

export default async function MePage(props: { searchParams: Promise<{ billing?: string | string[] }> }) {
  const session = await getServerAuthSession()
  if (!session?.user?.id) redirect('/auth/signin?callbackUrl=/me')
  const locale = await getLocale()
  // 结账成功后的回跳只用来显示“正在开通”，真值一律等 webhook（设计 §2）
  const billingParam = (await props.searchParams)?.billing
  const pendingActivation = (Array.isArray(billingParam) ? billingParam[0] : billingParam) === 'success'

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-bold text-gray-900">{t('pages.me.title', locale)}</h1>
      <ProfileTierHeader
        locale={locale}
        name={session.user.name}
        email={session.user.email}
        image={session.user.image}
      />
      {/* 用量表：接口缺席/未登录时 UsageMeter 返回 null，不留空节点（外层 space-y-6 不会多出间距） */}
      <UsageMeterClient size="full" locale={locale} />
      <SubscriptionCard locale={locale} pendingActivation={pendingActivation} />
      <ul className="grid gap-4 sm:grid-cols-2">
        {SECTION_KEYS.map((section) => (
          <li key={section.href}>
            <Link
              href={section.href}
              className="block rounded-2xl border border-gray-200 bg-white p-5 transition hover:border-brand-300 hover:shadow-sm"
            >
              <p className="font-semibold text-gray-900">{t(`pages.me.sections.${section.key}.title`, locale)}</p>
              <p className="mt-1 text-sm text-gray-500">{t(`pages.me.sections.${section.key}.desc`, locale)}</p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
