'use client'

import { useEffect } from 'react'

import { installTranslateGuard } from '@/lib/dom/translateGuard'

/**
 * 全站兜底：水合后给 `Node.prototype.removeChild / insertBefore` 打一层防御补丁，
 * 让浏览器翻译（Google 翻译把文本包进 `<font>` 并搬走节点）不至于把整页崩到错误边界。
 * 细节见 `lib/dom/translateGuard.ts`。
 *
 * 无 UI，只在 `app/layout.tsx` 的 `<body>` 最前面渲染一次；SSR 阶段什么都不做。
 */
export default function TranslateGuard() {
  useEffect(() => {
    installTranslateGuard()
  }, [])

  return null
}
