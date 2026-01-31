import { Suspense } from 'react'
import TranslationsUI from './ui'

export const metadata = {
  title: '翻译管理 - 管理后台',
}

export default function TranslationsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">翻译管理</h1>
        <p className="mt-1 text-sm text-gray-600">
          管理待审核的翻译任务
        </p>
      </div>
      <Suspense fallback={<div className="text-gray-600">加载中...</div>}>
        <TranslationsUI />
      </Suspense>
    </div>
  )
}
