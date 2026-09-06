'use client'

import type { SupportedLocale } from '@/lib/i18n/types'
import { useUsage } from '@/hooks/useUsage'
import { UsageMeter } from './UsageMeter'

/** 服务端页面（如 /me）里嵌用量表的客户端包装 */
export function UsageMeterClient(props: { size: 'compact' | 'full'; locale?: SupportedLocale }) {
  const { usage } = useUsage()
  return <UsageMeter usage={usage} size={props.size} locale={props.locale} />
}
