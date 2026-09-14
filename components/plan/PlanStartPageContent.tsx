import { redirect } from 'next/navigation'
import type { SiteLocale } from '@/components/layout/SiteShell'
import PlanStartClient from '@/app/(plan-start)/plan/start/ui'
import { getServerAuthSession } from '@/lib/auth/session'

/**
 * 三语起始页共享的服务器内容：读会话、做与 `app/(authed)/layout.tsx` 同序的
 * 两项密码检查、把 draft 截到 500 再传客户端、渲染 `PlanStartClient`。
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
  return (
    <PlanStartClient
      initialDraft={draft.slice(0, 500)}
      signedIn={Boolean(session?.user?.id)}
      locale={locale}
      syncLocaleCookie
    />
  )
}
