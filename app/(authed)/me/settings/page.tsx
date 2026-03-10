import { redirect } from 'next/navigation'
import { getServerAuthSession } from '@/lib/auth/session'
import { prisma } from '@/lib/db/prisma'
import SettingsForm from '@/components/me/SettingsForm.client'
import MeSectionShell from '@/components/me/MeSectionShell'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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
      <MeSectionShell
        activeTab="settings"
        title="个人信息"
        description="编辑你的公开资料与社交账号，保存后会同步到站点头像与昵称展示。"
      >
        <div className="rounded-3xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
          页面加载失败：{hint}
        </div>
      </MeSectionShell>
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
      <MeSectionShell
        activeTab="settings"
        title="个人信息"
        description="编辑你的公开资料与社交账号，保存后会同步到站点头像与昵称展示。"
      >
        <div className="rounded-3xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
          页面加载失败：{hint}
        </div>
      </MeSectionShell>
    )
  }

  if (!user) {
    redirect('/auth/signin')
  }

  return (
    <MeSectionShell
      activeTab="settings"
      title="个人信息"
      description="编辑你的公开资料与社交账号，保存后会同步到站点头像与昵称展示。"
    >
      <SettingsForm initialData={user} />
    </MeSectionShell>
  )
}
