import { redirect } from 'next/navigation'
import { getServerAuthSession } from '@/lib/auth/session'
import AdminLlmClient from './ui'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '模型接入',
  description: '管理自定义 LLM 供应商与接管范围。',
  alternates: { canonical: '/admin/llm' },
}

export default async function AdminLlmPage() {
  const session = await getServerAuthSession()
  if (!session?.user) redirect('/auth/signin')
  if (!session.user.isAdmin) {
    return <div className="text-gray-600">无权限访问。</div>
  }

  return <AdminLlmClient />
}
