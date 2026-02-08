'use client'

import { SessionProvider } from 'next-auth/react'
import NavigationProbe from '@/components/observability/NavigationProbe.client'

type Props = {
  children: React.ReactNode
}

export default function Providers({ children }: Props) {
  return (
    <SessionProvider>
      <NavigationProbe />
      {children}
    </SessionProvider>
  )
}
