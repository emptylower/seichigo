'use client'

import type { ReactNode } from 'react'
import { track } from '@/lib/analytics/track'

/**
 * 外部导航外链（只为埋点而存在的极小客户端壳）：资源页那几处链接挂在服务端组件里，
 * 用它包一层就能拿到 onClick，不必把整个父组件客户端化。
 * 行为与裸 `<a target="_blank">` 完全一致——不 preventDefault，不改跳转方式。
 */
export default function OutboundNavLink({
  href,
  kind,
  className,
  children,
}: {
  href: string
  /** 链接形态：点位详情页 place / 路线导航 directions */
  kind: 'place' | 'directions'
  className?: string
  children: ReactNode
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => track('outbound_navigation', { surface: 'resource', provider: 'google', kind })}
      className={className}
    >
      {children}
    </a>
  )
}
