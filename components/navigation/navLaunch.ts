'use client'

import { useEffect, useMemo, useState } from 'react'
import { orderTargets, type NavOrderCtx, type NavTarget } from '@/lib/route/navigationTargets'
import type { SupportedLocale } from '@/lib/i18n/types'

/** iOS 唤起 app 后等待多久判定「没装 / 没跳走」，再打开网页回退 */
export const APP_FALLBACK_MS = 1600

export type NavPlatform = Pick<NavOrderCtx, 'isIOS' | 'isAndroid'>

/** UA 判平台；iPadOS 13+ 报 Macintosh，用触点数区分 */
export function detectNavPlatform(userAgent: string, maxTouchPoints = 0): NavPlatform {
  const isIOS = /iPad|iPhone|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1)
  const isAndroid = !isIOS && /Android/i.test(userAgent)
  return { isIOS, isAndroid }
}

const MOBILE_UA = /Android|iPhone|iPad|iPod|Mobile/i

/**
 * Google 整天导航 waypoints 上限：触屏（pointer: coarse）或移动 UA → 3，否则 9。
 * effect 里读 matchMedia / navigator，首屏按桌面 9，避免 hydration 差异。
 */
export function useMaxNavWaypoints(): number {
  const [max, setMax] = useState(9)
  useEffect(() => {
    const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches
    const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent
    const touchPoints = typeof navigator === 'undefined' ? 0 : navigator.maxTouchPoints ?? 0
    const mobile = coarse || MOBILE_UA.test(ua) || detectNavPlatform(ua, touchPoints).isIOS
    setMax(mobile ? 3 : 9)
  }, [])
  return max
}

function readNavPlatform(): NavPlatform {
  if (typeof navigator === 'undefined') return { isIOS: false, isAndroid: false }
  return detectNavPlatform(navigator.userAgent, navigator.maxTouchPoints ?? 0)
}

/**
 * 按平台 + 语言排序并解析高德 appUrl。平台在首次渲染时同步读取（惰性初始值）：
 * 选项列表只在用户点开菜单 / sheet 后才挂载（纯客户端），不会有 hydration 差异，
 * 也不会出现「先按桌面排序、effect 后再重排」的闪动。
 */
export function useOrderedNavTargets(targets: NavTarget[], locale: SupportedLocale): NavTarget[] {
  const [platform] = useState<NavPlatform>(readNavPlatform)
  return useMemo(() => orderTargets(targets, { ...platform, locale }), [locale, platform, targets])
}

/** app：已转入后台 / Android intent 交给系统；web：新窗口打开了网页版；blocked：新窗口被拦截 */
export type LaunchOutcome = 'app' | 'web' | 'blocked'

type LaunchDeps = {
  /** 跳转 app scheme；默认改 window.location.href */
  assign?: (url: string) => void
  /** 唤起结束回调；blocked 时由调用方给出「网页版」入口让用户手动点（iOS 不在当前 tab 跳网页） */
  onSettled?: (outcome: LaunchOutcome) => void
}

const AMAP_ANDROID_PACKAGE = 'com.autonavi.minimap'

/**
 * Android 高德：amapuri://X → intent://X#Intent;scheme=amapuri;package=…;S.browser_fallback_url=…;end。
 * 没装 app 时由浏览器自己跳 fallback，不需要计时器。非 amapuri 链接返回 null。
 */
export function toAndroidIntentUrl(appUrl: string, webUrl: string): string | null {
  const prefix = 'amapuri://'
  if (!appUrl.startsWith(prefix)) return null
  const rest = appUrl.slice(prefix.length)
  return `intent://${rest}#Intent;scheme=amapuri;package=${AMAP_ANDROID_PACKAGE};S.browser_fallback_url=${encodeURIComponent(
    webUrl
  )};end`
}

/**
 * 唤起高德 app：
 * - Android（amapuri://）：改用 intent URL，浏览器负责未安装回退，立即 settle('app')。
 * - iOS（iosamap://）：先唤起，APP_FALLBACK_MS 内页面转入后台（visibilitychange→hidden /
 *   pagehide / blur）即视为已唤起，清除计时器与监听；超时仍在前台则新窗口打开网页版，
 *   被拦截时 settle('blocked')，不在当前 tab 跳转。
 * 返回取消函数（清计时器与监听）。
 */
export function launchAppWithFallback(appUrl: string, webUrl: string, deps: LaunchDeps = {}): () => void {
  const assign = deps.assign ?? ((url: string) => {
    window.location.href = url
  })
  const settle = (outcome: LaunchOutcome) => deps.onSettled?.(outcome)

  const intentUrl = toAndroidIntentUrl(appUrl, webUrl)
  if (intentUrl) {
    assign(intentUrl)
    settle('app')
    return () => {}
  }

  let timer: number | null = null
  const cleanup = () => {
    if (timer !== null) window.clearTimeout(timer)
    timer = null
    document.removeEventListener('visibilitychange', onVisibilityChange)
    window.removeEventListener('pagehide', onLeave)
    window.removeEventListener('blur', onLeave)
  }
  function onLeave() {
    cleanup()
    settle('app')
  }
  function onVisibilityChange() {
    if (document.visibilityState === 'hidden') onLeave()
  }

  document.addEventListener('visibilitychange', onVisibilityChange)
  window.addEventListener('pagehide', onLeave)
  window.addEventListener('blur', onLeave)
  assign(appUrl)
  timer = window.setTimeout(() => {
    cleanup()
    if (document.visibilityState === 'hidden') {
      settle('app')
      return
    }
    const opened = window.open(webUrl, '_blank')
    if (opened) {
      opened.opener = null
      settle('web')
      return
    }
    settle('blocked')
  }, APP_FALLBACK_MS)
  return cleanup
}
