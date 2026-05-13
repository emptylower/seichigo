import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { getJournalApiDeps } from '@/lib/journal/api'
import { getJournalSnapshot } from '@/lib/journal/handlers/getJournalSnapshot'
import { JournalUi } from './ui'

export const metadata: Metadata = {
  title: '我的手帐',
  description: '你和最爱的作品共同书写的日本旅行手帐（需要登录）。',
  alternates: { canonical: '/me/journal' },
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

export default async function JournalPage() {
  let deps
  try {
    deps = await getJournalApiDeps()
  } catch {
    redirect('/auth/signin?callbackUrl=/me/journal')
  }

  const session = await deps.getSession()
  if (!session?.user?.id) {
    redirect('/auth/signin?callbackUrl=/me/journal')
  }

  const snapshot = await getJournalSnapshot({
    userId: session.user.id,
    repo: deps.repo,
    now: deps.now,
  })

  if (!snapshot) {
    redirect('/auth/signin?callbackUrl=/me/journal')
  }

  return <JournalUi snapshot={snapshot} />
}
