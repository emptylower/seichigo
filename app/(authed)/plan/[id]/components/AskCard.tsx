'use client'

import { useMemo, useState } from 'react'
import { CalendarCheck, Check, ChevronLeft, ChevronRight, ListChecks, Minus, Plus } from 'lucide-react'
import type { AskUserOption, AskUserPayload } from '@/lib/planAgent/askUser'

/** 结构化组件提交给 ui.tsx 的回答：可读文本进消息流，answerValue 随 answerTo 回传后端 */
export type AskAnswer = { readableText: string; answerValue: unknown }

type AskCardProps = {
  payload: AskUserPayload
  disabled?: boolean
  onSubmit: (answer: AskAnswer) => void
}

/** ask_user 结构化提问卡片：按 kind 分发到日期区间 / 选择卡片 */
export function AskCard(props: AskCardProps) {
  if (props.payload.kind === 'date_range') return <DateRangeAsk {...props} />
  return <ChoiceAsk {...props} multiple={props.payload.kind === 'multi_choice'} />
}

/** 历史里已翻篇的 ask 渲染成折叠摘要 chip，文案取紧跟其后的那条消息 */
export function AskAnswerChip(props: { payload: AskUserPayload; answerText: string }) {
  const Icon = props.payload.kind === 'date_range' ? CalendarCheck : ListChecks
  return (
    <div className="inline-flex max-w-full items-center gap-2 rounded-full bg-brand-50 px-3 py-1 text-xs text-brand-700">
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{props.answerText}</span>
    </div>
  )
}

function SkipButton(props: { disabled?: boolean; onSubmit: (answer: AskAnswer) => void }) {
  return (
    <button
      type="button"
      disabled={props.disabled}
      onClick={() => props.onSubmit({ readableText: '（跳过这个问题）', answerValue: {} })}
      className="text-xs text-gray-400 underline underline-offset-2 transition hover:text-gray-600 disabled:opacity-50"
    >
      跳过
    </button>
  )
}

function CardShell(props: { prompt: string; allowSkip?: boolean; disabled?: boolean; onSubmit: (answer: AskAnswer) => void; children: React.ReactNode }) {
  return (
    <div className="max-w-[92%] rounded-2xl border border-brand-100 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-gray-900">{props.prompt}</p>
        {props.allowSkip ? <SkipButton disabled={props.disabled} onSubmit={props.onSubmit} /> : null}
      </div>
      <div className="pt-3">{props.children}</div>
    </div>
  )
}

// ---------- 日期区间 ----------

const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日']
const DAY_MS = 24 * 60 * 60 * 1000

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function toISODate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

type DateRangeMode = 'exact' | 'fuzzy'

function DateRangeAsk({ payload, disabled, onSubmit }: AskCardProps) {
  const [mode, setMode] = useState<DateRangeMode>('exact')
  const today = useMemo(() => startOfDay(new Date()), [])
  const [view, setView] = useState(() => ({ year: today.getFullYear(), month: today.getMonth() }))
  const [start, setStart] = useState<Date | null>(null)
  const [end, setEnd] = useState<Date | null>(null)
  const [chipOffset, setChipOffset] = useState(1)
  const [fuzzyDays, setFuzzyDays] = useState(3)

  const monthChips = useMemo(() => {
    return [0, 1, 2, 3].map((offset) => {
      const d = new Date(today.getFullYear(), today.getMonth() + offset, 1)
      const month = d.getMonth() + 1
      const crossYear = d.getFullYear() !== today.getFullYear()
      const monthName = crossYear ? `${d.getFullYear()}年${month}月` : `${month}月`
      const label = offset === 0 ? `本月（${monthName}）` : offset === 1 ? `下个月（${monthName}）` : monthName
      const spoken = offset === 0 ? '这个月' : offset === 1 ? '下个月' : monthName
      return { offset, label, spoken }
    })
  }, [today])

  const dayCount = start && end ? Math.round((startOfDay(end).getTime() - startOfDay(start).getTime()) / DAY_MS) + 1 : null

  function shiftMonth(delta: number) {
    setView((v) => {
      const d = new Date(v.year, v.month + delta, 1)
      return { year: d.getFullYear(), month: d.getMonth() }
    })
  }

  function pickDay(day: Date) {
    if (disabled || day < today) return
    if (!start || (start && end)) {
      setStart(day)
      setEnd(null)
      return
    }
    if (day.getTime() < start.getTime()) {
      setStart(day)
      setEnd(null)
    } else {
      setEnd(day)
    }
  }

  function submitExact() {
    if (!start || !end || !dayCount) return
    const endPart =
      (end.getFullYear() !== start.getFullYear() ? `${end.getFullYear()}年` : '') + `${end.getMonth() + 1}月${end.getDate()}日`
    onSubmit({
      readableText: `${start.getFullYear()}年${start.getMonth() + 1}月${start.getDate()}日出发，${endPart}返回，共${dayCount}天`,
      answerValue: { startDate: toISODate(start), dayCount },
    })
  }

  function submitFuzzy() {
    const chip = monthChips.find((c) => c.offset === chipOffset) ?? monthChips[1]
    onSubmit({
      readableText: `大概${chip.spoken}出发，玩${fuzzyDays}天`,
      answerValue: { dayCount: fuzzyDays },
    })
  }

  // 单月历格子：周一开头，前置空白 + 当月天数
  const firstWeekday = (new Date(view.year, view.month, 1).getDay() + 6) % 7
  const daysInMonth = new Date(view.year, view.month + 1, 0).getDate()
  const startTime = start ? startOfDay(start).getTime() : null
  const endTime = end ? startOfDay(end).getTime() : null

  return (
    <CardShell prompt={payload.prompt} allowSkip={payload.allowSkip} disabled={disabled} onSubmit={onSubmit}>
      <div className="inline-flex rounded-full bg-gray-100 p-0.5 text-xs">
        {(
          [
            ['exact', '精确日期'],
            ['fuzzy', '大概时间'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            disabled={disabled}
            onClick={() => setMode(value)}
            className={`rounded-full px-3 py-1 transition ${
              mode === value ? 'bg-white font-semibold text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === 'exact' ? (
        <div className="pt-3">
          <div className="flex items-center justify-between">
            <button
              type="button"
              aria-label="上个月"
              disabled={disabled}
              onClick={() => shiftMonth(-1)}
              className="inline-flex h-7 w-7 items-center justify-center rounded-full text-gray-500 transition hover:bg-gray-100 disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-sm font-semibold text-gray-900">
              {view.year}年{view.month + 1}月
            </span>
            <button
              type="button"
              aria-label="下个月"
              disabled={disabled}
              onClick={() => shiftMonth(1)}
              className="inline-flex h-7 w-7 items-center justify-center rounded-full text-gray-500 transition hover:bg-gray-100 disabled:opacity-40"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <div className="grid grid-cols-7 gap-1 pt-2 text-center text-[11px] text-gray-400">
            {WEEKDAY_LABELS.map((w) => (
              <span key={w}>{w}</span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1 pt-1">
            {Array.from({ length: firstWeekday }, (_, i) => (
              <span key={`blank-${i}`} />
            ))}
            {Array.from({ length: daysInMonth }, (_, i) => {
              const day = new Date(view.year, view.month, i + 1)
              const time = day.getTime()
              const isPast = day < today
              const isStart = startTime !== null && time === startTime
              const isEnd = endTime !== null && time === endTime
              const inRange = startTime !== null && endTime !== null && time > startTime && time < endTime
              return (
                <button
                  key={i + 1}
                  type="button"
                  disabled={disabled || isPast}
                  onClick={() => pickDay(day)}
                  className={`h-9 w-full rounded-full text-sm transition ${
                    isStart || isEnd
                      ? 'bg-brand-600 font-semibold text-white'
                      : inRange
                        ? 'bg-brand-100 text-gray-900'
                        : isPast
                          ? 'text-gray-300'
                          : 'text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  {i + 1}
                </button>
              )
            })}
          </div>
          <div className="flex items-center justify-between pt-3">
            <span className="text-xs text-gray-500">{dayCount ? `共 ${dayCount} 天` : start ? '再选返回日期' : '点选出发日期'}</span>
            <button
              type="button"
              disabled={disabled || !dayCount}
              onClick={submitExact}
              className="rounded-full bg-brand-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-brand-500 disabled:opacity-50"
            >
              确认
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3 pt-3">
          <div className="flex flex-wrap gap-2">
            {monthChips.map((chip) => (
              <button
                key={chip.offset}
                type="button"
                disabled={disabled}
                onClick={() => setChipOffset(chip.offset)}
                className={`rounded-full border px-3 py-1.5 text-xs transition ${
                  chipOffset === chip.offset
                    ? 'border-transparent bg-brand-600 font-semibold text-white'
                    : 'border-gray-200 text-gray-600 hover:border-brand-300'
                }`}
              >
                {chip.label}
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between">
            <div className="inline-flex items-center gap-3">
              <button
                type="button"
                aria-label="减少天数"
                disabled={disabled || fuzzyDays <= 1}
                onClick={() => setFuzzyDays((n) => Math.max(1, n - 1))}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 text-gray-600 transition hover:border-brand-300 disabled:opacity-40"
              >
                <Minus className="h-3.5 w-3.5" />
              </button>
              <span className="min-w-12 text-center text-sm font-semibold text-gray-900">{fuzzyDays} 天</span>
              <button
                type="button"
                aria-label="增加天数"
                disabled={disabled || fuzzyDays >= 30}
                onClick={() => setFuzzyDays((n) => Math.min(30, n + 1))}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 text-gray-600 transition hover:border-brand-300 disabled:opacity-40"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
            <button
              type="button"
              disabled={disabled}
              onClick={submitFuzzy}
              className="rounded-full bg-brand-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-brand-500 disabled:opacity-50"
            >
              确认
            </button>
          </div>
        </div>
      )}
    </CardShell>
  )
}

// ---------- 选择卡片 ----------

function ChoiceAsk({ payload, multiple, disabled, onSubmit }: AskCardProps & { multiple: boolean }) {
  const options = payload.options ?? []
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const selected = useMemo(() => new Set(selectedIds), [selectedIds])

  function pickSingle(option: AskUserOption) {
    if (disabled) return
    setSelectedIds([option.id])
    // 短暂延迟让选中态动画播完再提交
    window.setTimeout(() => {
      onSubmit({ readableText: option.label, answerValue: { optionId: option.id } })
    }, 180)
  }

  function toggleMulti(option: AskUserOption) {
    if (disabled) return
    setSelectedIds((prev) => (prev.includes(option.id) ? prev.filter((id) => id !== option.id) : [...prev, option.id]))
  }

  function submitMulti() {
    const chosen = options.filter((o) => selected.has(o.id))
    if (chosen.length === 0) return
    onSubmit({
      readableText: chosen.map((o) => o.label).join('、'),
      answerValue: { optionIds: chosen.map((o) => o.id) },
    })
  }

  return (
    <CardShell prompt={payload.prompt} allowSkip={payload.allowSkip} disabled={disabled} onSubmit={onSubmit}>
      <div className="-mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-1">
        {options.map((option) => {
          const isSelected = selected.has(option.id)
          return (
            <button
              key={option.id}
              type="button"
              disabled={disabled}
              onClick={() => (multiple ? toggleMulti(option) : pickSingle(option))}
              className={`relative w-40 shrink-0 snap-start overflow-hidden rounded-2xl border bg-white text-left transition ${
                isSelected ? 'border-transparent ring-2 ring-brand-500' : 'border-gray-200 hover:border-brand-300'
              } disabled:opacity-60`}
            >
              {isSelected ? (
                <span className="absolute right-2 top-2 z-10 inline-flex h-5 w-5 items-center justify-center rounded-full bg-brand-500">
                  <Check className="h-3 w-3 text-white" />
                </span>
              ) : null}
              {option.image ? (
                // eslint-disable-next-line @next/next/no-img-element -- 外部图源（Anitabi 等），不走 next/image 优化
                <img src={option.image} alt="" className="aspect-[3/4] w-full object-cover" />
              ) : (
                <div className="flex aspect-[3/4] w-full items-center justify-center bg-gradient-to-br from-brand-100 to-pink-50">
                  <span className="text-3xl font-bold text-brand-400">{option.label.slice(0, 1)}</span>
                </div>
              )}
              <div className="p-2.5">
                <p className="line-clamp-1 text-sm font-semibold text-gray-900">{option.label}</p>
                {option.sublabel ? <p className="line-clamp-1 pt-0.5 text-xs text-gray-500">{option.sublabel}</p> : null}
              </div>
            </button>
          )
        })}
      </div>
      {multiple ? (
        <div className="flex items-center justify-between pt-3">
          <span className="text-xs text-gray-500">已选 {selectedIds.length} 项</span>
          <button
            type="button"
            disabled={disabled || selectedIds.length === 0}
            onClick={submitMulti}
            className="rounded-full bg-brand-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-brand-500 disabled:opacity-50"
          >
            确认
          </button>
        </div>
      ) : null}
    </CardShell>
  )
}
