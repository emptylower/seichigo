import { redirect } from 'next/navigation'
import { getServerAuthSession } from '@/lib/auth/session'
import { prisma } from '@/lib/db/prisma'
import SettingsForm from '@/components/me/SettingsForm.client'

export const runtime = 'nodejs'

export const metadata = {
  title: '用户设置 - SeichiGo',
  description: '管理您的个人资料和账号设置',
}

export default async function SettingsPage() {
  let session: Awaited<ReturnType<typeof getServerAuthSession>>
  try {
    session = await getServerAuthSession()
  } catch (err) {
    const code = (err as any)?.code
    const msg = String((err as any)?.message || '')
    console.error('[me/settings] session failed', err)

    let hint = '请稍后再试。'
    if (code === 'P2021' || code === 'P2022') {
      hint = '数据库结构未更新，请先执行迁移（prisma migrate deploy）后重试。'
    } else if (msg.includes('Environment variable not found') && msg.includes('DATABASE_URL')) {
      hint = '数据库未配置（缺少 DATABASE_URL）。'
    }

    return (
      <div className="container mx-auto max-w-2xl py-8 px-4">
        <h1 className="text-2xl font-bold text-gray-900">用户设置</h1>
        <p className="mt-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          页面加载失败：{hint}
        </p>
      </div>
    )
  }
  
  if (!session?.user?.id) {
    redirect('/auth/signin')
  }

  let user: {
    name: string | null
    image: string | null
    bio: string | null
    bilibili: string | null
    weibo: string | null
    github: string | null
    twitter: string | null
  } | null = null

  try {
    user = await prisma.user.findUnique({
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
  } catch (err) {
    const code = (err as any)?.code
    const msg = String((err as any)?.message || '')
    console.error('[me/settings] load failed', err)

    let hint = '请稍后再试。'
    if (code === 'P2021' || code === 'P2022') {
      hint = '数据库结构未更新，请先执行迁移（prisma migrate deploy）后重试。'
    } else if (msg.includes('Environment variable not found') && msg.includes('DATABASE_URL')) {
      hint = '数据库未配置（缺少 DATABASE_URL）。'
    }

    return (
      <div className="container mx-auto max-w-2xl py-8 px-4">
        <h1 className="text-2xl font-bold text-gray-900">用户设置</h1>
        <p className="mt-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          页面加载失败：{hint}
        </p>
      </div>
    )
  }

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
