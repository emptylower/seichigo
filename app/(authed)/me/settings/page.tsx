import { redirect } from 'next/navigation'
import { getServerAuthSession } from '@/lib/auth/session'
import { prisma } from '@/lib/db/prisma'
import SettingsForm from '@/components/me/SettingsForm.client'

export const metadata = {
  title: '用户设置 - SeichiGo',
  description: '管理您的个人资料和账号设置',
}

export default async function SettingsPage() {
  const session = await getServerAuthSession()
  
  if (!session?.user?.id) {
    redirect('/auth/signin')
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      name: true,
      image: true,
      bio: true,
      bilibili: true,
      weibo: true,
      github: true,
      twitter: true,
    },
  })

  if (!user) {
    redirect('/auth/signin')
  }

  return (
    <div className="container mx-auto max-w-2xl py-8 px-4">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">用户设置</h1>
        <p className="mt-2 text-gray-600">管理您的个人资料和展示信息</p>
      </div>
      <SettingsForm initialData={user} />
    </div>
  )
}
