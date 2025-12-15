import SiteShell from '@/components/layout/SiteShell'
import { redirect } from 'next/navigation'
import { getServerAuthSession } from '@/lib/auth/session'

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerAuthSession()
  if (session?.user?.needsPasswordSetup) {
    redirect('/auth/set-password')
  }
  if (session?.user?.isAdmin && session?.user?.mustChangePassword) {
    redirect('/auth/change-password')
  }
  return <SiteShell>{children}</SiteShell>
}
