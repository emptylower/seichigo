'use client'

import { AdminErrorState } from '@/components/admin/state/AdminErrorState'

type Props = {
  error: Error & { digest?: string }
  reset: () => void
}

export default function AdminError({ error, reset }: Props) {
  return <AdminErrorState message={error.message || '管理后台加载失败'} onRetry={reset} />
}
