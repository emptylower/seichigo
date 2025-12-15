import { redirect } from 'next/navigation'
import { getServerAuthSession } from '@/lib/auth/session'
import AdminPanelArticleClient from './ui'

export const metadata = { title: '文章管理' }

export default async function AdminPanelArticlePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getServerAuthSession()
  if (!session?.user) redirect('/auth/signin')
  if (!session.user.isAdmin) {
    return <div className="text-gray-600">无权限访问。</div>
  }
  const { id } = await params
  return <AdminPanelArticleClient id={id} />
}

