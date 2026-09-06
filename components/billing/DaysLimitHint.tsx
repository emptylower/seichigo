import { TierHint } from './TierHint'

/**
 * 行程天数已经顶到当前档位上限时的升级提示（设计 §4）。
 * maxDays >= 30 视为「不限」，任何情况下都不提示；未达上限也不提示。
 * 抽成独立组件是为了不把这段条件塞进已接近行数预算的 DayCards.tsx。
 */
export function DaysLimitHint(props: { dayCount: number; maxDays?: number | null }) {
  const maxDays = props.maxDays ?? 0
  if (!Number.isFinite(maxDays) || maxDays <= 0 || maxDays >= 30) return null
  if (props.dayCount < maxDays) return null
  return <TierHint kind="days" />
}
