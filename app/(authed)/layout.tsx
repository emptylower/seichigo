import SiteShellPublic from '@/components/layout/SiteShellPublic'
import { redirect } from 'next/navigation'
import { getServerAuthSession } from '@/lib/auth/session'
import { getLocale } from '@/lib/i18n/getLocale'

export default async function AuthedLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerAuthSession()
  if (session?.user?.needsPasswordSetup) {
    redirect('/auth/set-password')
  }
  if (session?.user?.isAdmin && session?.user?.mustChangePassword) {
    redirect('/auth/change-password')
  }
  const locale = await getLocale()
  return <SiteShellPublic locale={locale}>{children}</SiteShellPublic>
}
