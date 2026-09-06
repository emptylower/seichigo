'use client'

import { useUsage } from '@/hooks/useUsage'
import { UsageMeter } from './UsageMeter'

/** 服务端页面（如 /me）里嵌用量表的客户端包装 */
export function UsageMeterClient(props: { size: 'compact' | 'full' }) {
  const { usage } = useUsage()
  return <UsageMeter usage={usage} size={props.size} />
}
