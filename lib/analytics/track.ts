/**
 * GA4 自定义事件上报（设计见 docs/superpowers/plans/2026-09-21-ga-custom-events.md）。
 *
 * 三条硬约束：
 * 1. 永远不抛错——整段 try/catch 兜底，埋点挂了也不能影响业务；
 * 2. 永远不阻塞——同步 push 进 dataLayer 就返回，调用方不需要 await；
 * 3. 不带个人信息——调用方只传枚举值与计数，不传邮箱/用户 id/prompt 正文/计划 id。
 */

/** 事件名一律 snake_case；能用 GA4 推荐名的（sign_up / login / share / begin_checkout）就用推荐名 */
export type AnalyticsEvent =
  | 'plan_start'
  | 'plan_login_required'
  | 'plan_generated'
  | 'sign_up'
  | 'login'
  | 'map_point_open'
  | 'map_anime_select'
  | 'outbound_navigation'
  | 'share'
  | 'begin_checkout'

// source/medium/campaign 等是 GA4 会话流量归因的保留参数名：事件一旦带上它们，
// 该访客的会话来源会被改写成这些值（报表里出现 marker / (not set) 这类假来源），类型层面直接禁掉
export type AnalyticsParams = Record<string, string | number | boolean | undefined> & {
  source?: never
  medium?: never
  campaign?: never
  campaign_id?: never
  term?: never
  content?: never
}

/** GA4 measurement id：track.ts 与 app/layout.tsx 的内联 config 共用同一份，改一处即可 */
export const GA_MEASUREMENT_ID = 'G-F7E894BEWR'

/** GA4 自定义参数的字符串上限远不止这个数，截断只是防调用方误传长文本 */
const PARAM_MAX_LENGTH = 100

type DataLayerWindow = Window & {
  dataLayer?: unknown[]
  /** 全局只发一次的 config 标记：layout 内联脚本与 track() 谁先跑谁置位 */
  __seichigoGaConfigured?: boolean
}

/** 读 localStorage 可能抛错（隐私模式/禁用存储）：埋点调试逃生门，读不到就当没开 */
function isGaDebug(): boolean {
  try {
    return window.localStorage.getItem('ga_debug') === '1'
  } catch {
    return false
  }
}

/**
 * 只有生产域名才上报：localhost、预览域名一律 no-op。
 * GA 里现在有 `localhost:3457 / referral` 这类开发污染，这条守卫就是为了挡它。
 */
export function isAnalyticsHost(hostname: string): boolean {
  return hostname === 'seichigo.com' || hostname.endsWith('.seichigo.com')
}

/** 从路径前缀推断站点语言，与 lib/i18n/resolveRequestLocale.ts 同一套规则 */
function localeFromPathname(pathname: string): 'zh' | 'en' | 'ja' {
  if (pathname === '/en' || pathname.startsWith('/en/')) return 'en'
  if (pathname === '/ja' || pathname.startsWith('/ja/')) return 'ja'
  return 'zh'
}

/**
 * 事件若早于 `gtag('config')` 入队会被 gtag.js 丢弃（懒加载场景首帧就发埋点会丢整类事件）。
 * 这里不依赖 layout 的内联脚本：track 自己按 gtag 协议先补 js+config，再置全局标记；
 * 内联脚本看到标记已置位就跳过，保证 config 全局只发一次（否则 page_view 会重复）。
 */
function ensureConfigured(target: DataLayerWindow, dataLayer: unknown[]): void {
  if (target.__seichigoGaConfigured === true) return
  function gtag(_command: string, ..._args: unknown[]) {
    // GA 只认 arguments 对象，推普通数组不会被识别成指令
    dataLayer.push(arguments)
  }
  gtag('js', new Date())
  gtag('config', GA_MEASUREMENT_ID)
  target.__seichigoGaConfigured = true
}

export function track(event: AnalyticsEvent, params?: AnalyticsParams): void {
  try {
    // SSR / 预渲染阶段没有 window，直接放弃这一次上报
    if (typeof window === 'undefined') return
    const target = window as DataLayerWindow
    const hostOk = isAnalyticsHost(window.location.hostname)
    // 调试逃生门：非生产域名也只打日志、不推 dataLayer，方便本地/预览自测
    const debug = isGaDebug()
    if (!hostOk && !debug) return

    // locale 默认按路径推断；调用方显式传了就以调用方为准（下面的循环会覆盖）
    const payload: Record<string, string | number | boolean> = {
      locale: localeFromPathname(window.location.pathname),
    }
    for (const [key, value] of Object.entries(params ?? {})) {
      if (value === undefined) continue
      payload[key] = typeof value === 'string' ? value.slice(0, PARAM_MAX_LENGTH) : value
    }

    if (debug) {
      try {
        // eslint-disable-next-line no-console
        console.debug('[ga]', event, payload)
      } catch {
        /* console 也不可靠时静默丢掉 */
      }
    }
    if (!hostOk) return

    const dataLayer = (target.dataLayer ??= [])
    ensureConfigured(target, dataLayer)
    // gtag 脚本是 lazyOnload，埋点可能早于它落地：不依赖 window.gtag 存在，
    // 直接按 gtag 自己的实现把 arguments 对象推进 dataLayer——GA 只认 arguments，
    // 推普通数组进去不会被识别成事件。
    function gtag(_command: 'event', _event: AnalyticsEvent, _params: Record<string, unknown>) {
      dataLayer.push(arguments)
    }
    gtag('event', event, payload)
  } catch {
    /* 埋点失败静默吞掉：任何异常都不能外泄到调用方 */
  }
}
