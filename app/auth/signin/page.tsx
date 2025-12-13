import { Suspense } from 'react'
import SignInClient from './ui'

export const metadata = { title: '登录' }

export default function SignInPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-md px-4 py-12 text-gray-600">加载中…</div>}>
      <SignInClient />
    </Suspense>
  )
}
