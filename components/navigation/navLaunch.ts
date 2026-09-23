'use client'

import { useEffect, useMemo, useState } from 'react'
import { orderTargets, type NavOrderCtx, type NavTarget } from '@/lib/route/navigationTargets'
import type { SupportedLocale } from '@/lib/i18n/types'

/** 唤起 app 后等待多久判定「没装 / 没跳走」，再打开网页回退 */
export const APP_FALLBACK_MS = 1600

export type NavPlatform = Pick<NavOrderCtx, 'isIOS' | 'isAndroid'>

/** UA 判平台；iPadOS 13+ 报 Macintosh，用触点数区分 */
export function detectNavPlatform(userAgent: string, maxTouchPoints = 0): NavPlatform {
  const isIOS = /iPad|iPhone|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1)
  const isAndroid = !isIOS && /Android/i.test(userAgent)
  return { isIOS, isAndroid }
}

/**
 * 按平台 + 语言排序并解析高德 appUrl。平台只在 effect 里读 navigator，
 * 首屏按「非移动端」排序，避免 hydration mismatch。
 */
export function useOrderedNavTargets(targets: NavTarget[], locale: SupportedLocale): NavTarget[] {
  const [platform, setPlatform] = useState<NavPlatform>({ isIOS: false, isAndroid: false })

  useEffect(() => {
    if (typeof navigator === 'undefined') return
    setPlatform(detectNavPlatform(navigator.userAgent, navigator.maxTouchPoints ?? 0))
  }, [])

  return useMemo(() => orderTargets(targets, { ...platform, locale }), [locale, platform, targets])
}

type LaunchDeps = {
  /** 跳转 app scheme；默认改 window.location.href */
  assign?: (url: string) => void
}

/**
 * 先唤起 app（appUrl），APP_FALLBACK_MS 内页面没有转入后台（visibilityState 仍非 hidden）
 * 视为未安装，新开网页回退；新窗口被拦截时在当前页打开。
 */
export function launchAppWithFallback(appUrl: string, webUrl: string, deps: LaunchDeps = {}): void {
  const assign = deps.assign ?? ((url: string) => {
    window.location.href = url
  })
  assign(appUrl)
  window.setTimeout(() => {
    if (document.visibilityState === 'hidden') return
    const opened = window.open(webUrl, '_blank')
    if (opened) {
      opened.opener = null
      return
    }
    assign(webUrl)
  }, APP_FALLBACK_MS)
}
