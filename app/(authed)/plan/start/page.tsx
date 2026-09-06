import { getServerAuthSession } from '@/lib/auth/session'
import { getLocale } from '@/lib/i18n/getLocale'
import PlanStartClient from './ui'
import { parseStartLocale } from './locale'

export const dynamic = 'force-dynamic'

/**
 * 规划师起始页：首页输入框的落点。**不做游客重定向**——游客可以进来把话
 * 说完，真正发送时才弹登录（`ui.tsx` 里的 LoginModal）。
 * 语言：显式 `?locale=` 合法值 > 站点解析（getLocale）；显式给出时由客户端
 * 同步 NEXT_LOCALE cookie，让创建后跳转的 /plan/<id> 保持同一语言。
 */
export default async function PlanStartPage(props: {
  searchParams: Promise<{ draft?: string | string[]; locale?: string | string[] }>
}) {
  const searchParams = await props.searchParams
  const raw = searchParams?.draft
  const draft = typeof raw === 'string' ? raw : Array.isArray(raw) ? (raw[0] ?? '') : ''
  const fromQuery = parseStartLocale(searchParams?.locale)
  const locale = fromQuery ?? (await getLocale())
  const session = await getServerAuthSession()
  return (
    <PlanStartClient
      initialDraft={draft.slice(0, 500)}
      signedIn={Boolean(session?.user?.id)}
      locale={locale}
      syncLocaleCookie={fromQuery !== null}
    />
  )
}
