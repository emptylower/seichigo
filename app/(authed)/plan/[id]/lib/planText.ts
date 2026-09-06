import { t } from '@/lib/i18n'
import type { SupportedLocale } from '@/lib/i18n/types'

export type PlanTextVars = Record<string, string | number>

/**
 * 计划页文案入口：键统一挂在 `pages.plan.*` 下，占位符沿用站内的 `{name}`
 * 风格（`t()` 本身不做替换，替换在调用方——与首页等现有用法一致）。
 */
export function planText(locale: SupportedLocale, key: string, vars?: PlanTextVars): string {
  let out = t(`pages.plan.${key}`, locale)
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
