import { Suspense } from 'react'
import TranslationDetailUI from './ui'

export const metadata = {
  title: '翻译详情 - 管理后台',
}

type Props = {
  params: Promise<{ id: string }>
}

export default async function TranslationDetailPage({ params }: Props) {
  const { id } = await params

  return (
    <div className="space-y-6">
      <Suspense fallback={<div className="text-gray-600">加载中...</div>}>
        <TranslationDetailUI id={id} />
      </Suspense>
    </div>
  )
}
