import Link from 'next/link'
import { Lock } from 'lucide-react'
import { t } from '@/lib/i18n'
import type { SupportedLocale } from '@/lib/i18n/types'
import { prefixPath } from '@/components/layout/prefixPath'

export type TierHintKind = 'transit' | 'restaurant' | 'map' | 'days'

/** 档位差异提示（设计 §4）：只在对应 hint 为 true 时渲染，永远指向套餐页 */
export function TierHint(props: { kind: TierHintKind; locale?: SupportedLocale }) {
  const locale = props.locale ?? 'zh'
  return (
    <Link
      href={prefixPath('/pricing', locale)}
      className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-brand-200 bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-600 hover:bg-brand-100"
    >
      <Lock className="h-3 w-3" aria-hidden />
      {t(`billing.hint.${props.kind}`, locale)}
    </Link>
  )
}
