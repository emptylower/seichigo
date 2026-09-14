import { redirect } from 'next/navigation'
import type { SiteLocale } from '@/components/layout/SiteShell'
import PlanStartView from '@/components/plan/PlanStartView'
import { getServerAuthSession } from '@/lib/auth/session'
import { getTripPlanApiDeps } from '@/lib/tripPlan/api'

/**
 * 三语起始页共享的服务器内容：读会话、做与 `app/(authed)/layout.tsx` 同序的
 * 两项密码检查、把 draft 截到 500 再传客户端；登录用户顺带查 `listPlans`
 * 映射成侧栏列表（游客传 []），渲染 `PlanStartView`。
 * 语言由路径绑定（zh=/plan/start、en=/en/plan/start、ja=/ja/plan/start），
 * 三个入口都传 `syncLocaleCookie`，让创建后跳转的无前缀 `/plan/<id>` 延续
 * 同一语言。
 */
export default async function PlanStartPageContent({
  locale,
  draft,
}: {
  locale: SiteLocale
  draft: string
}) {
  const session = await getServerAuthSession()
  if (session?.user?.needsPasswordSetup) {
    redirect('/auth/set-password')
  }
  if (session?.user?.isAdmin && session?.user?.mustChangePassword) {
    redirect('/auth/change-password')
  }
  const userId = session?.user?.id
  let plans: { id: string; title: string; updatedAt: string }[] = []
  if (userId) {
    const deps = await getTripPlanApiDeps()
    plans = (await deps.repo.listPlans(userId)).map((p) => ({
      id: p.id,
      title: p.title,
      updatedAt: p.updatedAt.toISOString(),
    }))
  }
  return (
    <PlanStartView
      plans={plans}
      initialDraft={draft.slice(0, 500)}
      signedIn={Boolean(userId)}
      locale={locale}
      syncLocaleCookie
    />
  )
}
