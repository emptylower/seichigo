import { t } from '@/lib/i18n'
import type { SupportedLocale } from '@/lib/i18n/types'

/** routebook 域文案查表 + {var} 插值（t() 本身不支持插值） */
export function tr(key: string, locale: SupportedLocale, vars?: Record<string, string | number>): string {
  let out = t(key, locale)
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      out = out.split(`{${name}}`).join(String(value))
    }
  }
  return out
}
