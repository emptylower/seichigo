import Link from 'next/link'
import { Lock } from 'lucide-react'

const TEXT = {
  transit: '升级后可查看真实路线与耗时',
  restaurant: '升级后可推荐餐厅',
} as const

/** 免费档唯一允许出现的两处档位差异提示（设计 §4） */
export function TierHint(props: { kind: keyof typeof TEXT }) {
  return (
    <Link
      href="/pricing"
      className="inline-flex items-center gap-1 rounded-full border border-brand-200 bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-600 hover:bg-brand-100"
    >
      <Lock className="h-3 w-3" aria-hidden />
      {TEXT[props.kind]}
    </Link>
  )
}
