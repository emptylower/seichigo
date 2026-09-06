import Link from 'next/link'
import { Lock } from 'lucide-react'

const TEXT = {
  transit: '升级后可查看真实路线与耗时',
  restaurant: '升级后可推荐餐厅',
  map: '升级后显示真实路线',
  days: '升级可规划更多天数',
} as const

export type TierHintKind = keyof typeof TEXT

/** 档位差异提示（设计 §4）：只在对应 hint 为 true 时渲染，永远指向 /pricing */
export function TierHint(props: { kind: TierHintKind }) {
  return (
    <Link
      href="/pricing"
      className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-brand-200 bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-600 hover:bg-brand-100"
    >
      <Lock className="h-3 w-3" aria-hidden />
      {TEXT[props.kind]}
    </Link>
  )
}
