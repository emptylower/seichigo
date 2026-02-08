import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { getServerAuthSession } from '@/lib/auth/session'
import { AdminSkeleton } from '@/components/admin/state/AdminSkeleton'
import TranslationDetailUI from './ui'

export const metadata = {
  title: '翻译详情 - 管理后台',
}

type Props = {
  params: Promise<{ id: string }>
}

export default async function TranslationDetailPage({ params }: Props) {
  const session = await getServerAuthSession()
  if (!session?.user) redirect('/auth/signin')
  if (!session.user.isAdmin) {
    return <div className="text-gray-600">无权限访问。</div>
  }

  const { id } = await params

  return (
    <div className="space-y-6">
      <Suspense fallback={<AdminSkeleton rows={10} />}>
        <TranslationDetailUI id={id} />
      </Suspense>
    </div>
  )
}
