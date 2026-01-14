import { Suspense } from 'react'
import SignInClient from './ui'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '登录',
  description: '使用邮箱验证码或密码登录 SeichiGo。',
  alternates: { canonical: '/auth/signin' },
}

export default function SignInPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-md px-4 py-12 text-gray-600">加载中…</div>}>
      <SignInClient />
    </Suspense>
  )
}
