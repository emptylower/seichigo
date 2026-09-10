import { t } from '@/lib/i18n'
import type { SupportedLocale } from '@/lib/i18n/types'

export type PlanTextVars = Record<string, string | number>

/**
 * 计划页本地词条：平滑渲染阶段二新增的键，暂未迁入 lib/i18n/locales（该目录
 * 不在本批改动边界内）。键命名与全局字典 `pages.plan.*` 下的相对键同构，
 * 命中本地优先；迁移时把条目搬进 locales/*.json 即可，调用方不用动。
 */
const PLAN_LOCAL_TEXT: Record<SupportedLocale, Record<string, string>> = {
  zh: {
    // C1 active pill 的活动计时（区别于定格摘要的 thinking.elapsed「用时」）
    'thinking.elapsedLive': '已用 {seconds}s',
    // C2 观察流退避重连时的 pill 文案
    'thinking.reconnecting': '连接不稳，重试中…',
  },
  en: {
    'thinking.elapsedLive': '{seconds}s elapsed',
    'thinking.reconnecting': 'Connection unstable, retrying…',
  },
  ja: {
    'thinking.elapsedLive': '経過 {seconds}s',
    'thinking.reconnecting': '接続が不安定です。再試行中…',
  },
}

/**
 * 计划页文案入口：键统一挂在 `pages.plan.*` 下，占位符沿用站内的 `{name}`
 * 风格（`t()` 本身不做替换，替换在调用方——与首页等现有用法一致）。
 */
export function planText(locale: SupportedLocale, key: string, vars?: PlanTextVars): string {
  let out = PLAN_LOCAL_TEXT[locale][key] ?? t(`pages.plan.${key}`, locale)
  if (vars) {
    for (const [name, value] of Object.entries(vars)) out = out.split(`{${name}}`).join(String(value))
  }
  return out
}

export type PlanTextFn = (key: string, vars?: PlanTextVars) => string

/** 组件内绑定 locale 的取文案函数（`const tx = planTextFor(locale)`） */
export function planTextFor(locale: SupportedLocale): PlanTextFn {
  return (key, vars) => planText(locale, key, vars)
}
