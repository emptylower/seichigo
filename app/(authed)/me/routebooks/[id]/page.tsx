import { getServerAuthSession } from '@/lib/auth/session'
import RouteBookDetailClient from './ui'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '地图详情',
  description: '查看和编辑你的巡礼地图。',
  robots: { index: false, follow: false },
}
export const dynamic = 'force-dynamic'

export default async function RouteBookDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  let session: any = null
  try {
    if (process.env.DATABASE_URL) {
      session = await getServerAuthSession()
    }
  } catch {
    session = null
  }

  if (!session?.user?.id) {
    return (
      <section data-layout-wide="true" data-layout-immersive="true" className="min-h-dvh px-4 py-10 sm:px-6">
        <div className="mx-auto flex min-h-[70vh] max-w-xl items-center justify-center">
          <div className="w-full rounded-[32px] border border-pink-100/90 bg-white/90 p-8 shadow-[0_30px_60px_-40px_rgba(15,23,42,0.42)]">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">地图详情</h1>
            <p className="mt-2 text-sm leading-6 text-slate-600">请先登录后查看并编辑你的巡礼路线。</p>
            <a className="btn-primary mt-5 inline-flex w-fit no-underline" href={`/auth/signin?callbackUrl=${encodeURIComponent(`/me/routebooks/${id}`)}`}>
              去登录
            </a>
          </div>
        </div>
      </section>
    )
  }

  return <RouteBookDetailClient id={id} />
}
