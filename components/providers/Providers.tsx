'use client'

import { useState } from 'react'
import { SessionProvider } from 'next-auth/react'
import NavigationProbe from '@/components/observability/NavigationProbe.client'
import { hasAuthHintCookie } from '@/lib/auth/clientAuthHint'

type Props = {
  children: React.ReactNode
}

export default function Providers({ children }: Props) {
  // 无 sg_auth 标记 = 匿名访客：传 session={null} 让 next-auth 跳过初始
  // /api/auth/session 请求（性能优化 2026-09-07）。惰性 useState 保证 SSR
  // 与首次客户端渲染走同一初始化；此 prop 只影响是否发请求，不影响 DOM。
  const [anonymous] = useState(() => !hasAuthHintCookie())
  return (
    <SessionProvider
      refetchOnWindowFocus={false}
      refetchInterval={0}
      {...(anonymous ? { session: null } : {})}
    >
      <NavigationProbe />
      {children}
    </SessionProvider>
  )
}
