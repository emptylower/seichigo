import { Suspense } from 'react'
import SignUpClient from './ui'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '注册',
  description: '使用邮箱验证码注册 SeichiGo。',
  alternates: { canonical: '/auth/signup' },
}

export default function SignUpPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-md px-4 py-12 text-gray-600">加载中…</div>}>
      <SignUpClient />
    </Suspense>
  )
}
