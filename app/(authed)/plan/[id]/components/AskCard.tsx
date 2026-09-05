'use client'

import { useMemo, useState } from 'react'
import { CalendarCheck, Check, ChevronLeft, ChevronRight, Lightbulb, ListChecks, Minus, PenLine, Plus } from 'lucide-react'
import { isAskCustomOption, reservedCustomOption, type AskUserOption, type AskUserPayload } from '@/lib/planAgent/askUser'
import ResilientMapImage from '@/components/map/ResilientMapImage'
import { useDragToScroll } from '@/lib/hooks/useDragToScroll'
import { useClientToday } from '../hooks/useClientFormattedTime'
import { MapPin } from 'lucide-react'

/** 结构化组件提交给 ui.tsx 的回答：可读文本进消息流，answerValue 随 answerTo 回传后端 */
export type AskAnswer = { readableText: string; answerValue: unknown }

type AskCardProps = {
  payload: AskUserPayload
  disabled?: boolean
  onSubmit: (answer: AskAnswer) => void
}

/**
 * ask_user 结构化提问卡片：按任务类型（taskType，视图层已归一化，恒存在）
 * 分发——日期走日历；作品选择走封面卡（视觉/语义不变，无卡内自定义入口，
 * 自由文本由全局输入框兜底）；意见题走独立的文本优先选项卡（末位带自定义
 * 输入）。渲染层不做"有没有图/bangumiId"之类的猜测分流。
 */
export function AskCard(props: AskCardProps) {
  const { payload } = props
  if (payload.kind === 'date_range' || payload.taskType === 'date_range') return <DateRangeAsk {...props} />
  if (payload.taskType === 'opinion') return <OpinionChoiceAsk {...props} multiple={payload.kind === 'multi_choice'} />
  return <ChoiceAsk {...props} />
}

/** 历史里已翻篇的 ask 渲染成折叠摘要 chip，文案取紧跟其后的那条消息；图标按任务类型区分 */
export function AskAnswerChip(props: { payload: AskUserPayload; answerText: string }) {
  const taskType = props.payload.taskType ?? (props.payload.kind === 'date_range' ? 'date_range' : 'work_selection')
  const Icon = taskType === 'date_range' ? CalendarCheck : taskType === 'opinion' ? Lightbulb : ListChecks
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
  // 水合安全（React #418）：渲染期「今天」依赖本地时区，SSR（UTC）与浏览器
  // 可能不同日/不同月；首帧 null（日历/月份文本不渲染），effect 后填充
  const today = useClientToday()
  // 视图月份：无手动翻页时跟随 today 派生（today 未就绪为 null，不渲染日历）
  const [viewOverride, setViewOverride] = useState<{ year: number; month: number } | null>(null)
  const view = viewOverride ?? (today ? { year: today.getFullYear(), month: today.getMonth() } : null)
  const [start, setStart] = useState<Date | null>(null)
  const [end, setEnd] = useState<Date | null>(null)
  const [chipOffset, setChipOffset] = useState(1)
  const [fuzzyDays, setFuzzyDays] = useState(3)

  const monthChips = useMemo(() => {
    if (!today) return []
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
    if (!view) return
    const d = new Date(view.year, view.month + delta, 1)
    setViewOverride({ year: d.getFullYear(), month: d.getMonth() })
  }

  function pickDay(day: Date) {
    if (disabled || !today || day < today) return
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

  // 单月历格子：周一开头，前置空白 + 当月天数（today/view 未就绪时给 0，日历不渲染）
  const firstWeekday = view ? (new Date(view.year, view.month, 1).getDay() + 6) % 7 : 0
  const daysInMonth = view ? new Date(view.year, view.month + 1, 0).getDate() : 0
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

      {/* today 未就绪（SSR/水合首帧）时不渲染依赖本地时区的日历/月份文本，同尺寸占位防跳动 */}
      {today && view ? (
        mode === 'exact' ? (
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
        )
      ) : (
        <div className="pt-3">
          <div className="h-80" />
        </div>
      )}
    </CardShell>
  )
}

// ---------- 选择卡片 ----------

function OptionCover(props: { option: AskUserOption }) {
  const { option } = props
  if (!option.image) {
    return (
      <div className="flex aspect-[3/4] w-full items-center justify-center bg-gradient-to-br from-brand-100 to-pink-50">
        <span className="text-3xl font-bold text-brand-400">{option.label.slice(0, 1)}</span>
      </div>
    )
  }
  // 与 /map 同源图片策略：候选梯 + 代理重试（不在这里另立第二套 URL 规则）
  return (
    <ResilientMapImage
      src={option.image}
      alt={option.label}
      kind="cover"
      loading="lazy"
      className="aspect-[3/4] w-full object-cover"
      fallback={
        <div className="flex aspect-[3/4] w-full items-center justify-center bg-gradient-to-br from-brand-100 to-pink-50">
          <MapPin className="h-6 w-6 text-brand-300" />
        </div>
      }
    />
  )
}

/**
 * 作品选择卡：无论 single_choice / multi_choice 一律按多选交互——点卡片只切换
 * 选中态（不自动提交），底部常驻"已选 N 项 + 确认"提交条。提交时保持后端答复
 * 契约：single_choice 且恰好选 1 项回 { optionId }，其余回 { optionIds }。
 * （最终澄清 2026-09-01）：不渲染卡内自定义入口——自由文本由全局输入框兜底。
 * 历史过渡期落库的 work 载荷可能残留保留的 __custom__ 选项，这里统一过滤，
 * 保证旧作品卡 UI 不变。
 */
function ChoiceAsk({ payload, disabled, onSubmit }: AskCardProps) {
  const modelOptions = (payload.options ?? []).filter((o) => !isAskCustomOption(o))
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const selected = useMemo(() => new Set(selectedIds), [selectedIds])
  // 滚动条已全站隐藏，桌面纯鼠标用户靠按住拖动访问被裁切的卡片
  const dragScroll = useDragToScroll()

  function toggle(option: AskUserOption) {
    if (disabled) return
    setSelectedIds((prev) => (prev.includes(option.id) ? prev.filter((id) => id !== option.id) : [...prev, option.id]))
  }

  function submit() {
    const chosen = modelOptions.filter((o) => selected.has(o.id))
    if (chosen.length === 0) return
    onSubmit({
      readableText: chosen.map((o) => o.label).join('、'),
      answerValue:
        payload.kind === 'single_choice' && chosen.length === 1
          ? { optionId: chosen[0]!.id }
          : { optionIds: chosen.map((o) => o.id) },
    })
  }

  return (
    <CardShell prompt={payload.prompt} allowSkip={payload.allowSkip} disabled={disabled} onSubmit={onSubmit}>
      <div
        ref={dragScroll.ref}
        {...dragScroll.handlers}
        className={`-mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-1 ${dragScroll.cursorClass}`}
      >
        {modelOptions.map((option) => {
          const isSelected = selected.has(option.id)
          return (
            <button
              key={option.id}
              type="button"
              disabled={disabled}
              onClick={() => toggle(option)}
              className={`relative w-40 shrink-0 snap-start overflow-hidden rounded-2xl border bg-white text-left transition ${
                isSelected ? 'border-transparent ring-2 ring-brand-500' : 'border-gray-200 hover:border-brand-300'
              } disabled:opacity-60`}
            >
              {isSelected ? (
                <span className="absolute right-2 top-2 z-10 inline-flex h-5 w-5 items-center justify-center rounded-full bg-brand-500">
                  <Check className="h-3 w-3 text-white" />
                </span>
              ) : null}
              <OptionCover option={option} />
              <div className="p-2.5">
                <p className="line-clamp-1 text-sm font-semibold text-gray-900">{option.label}</p>
                {option.sublabel ? <p className="line-clamp-1 pt-0.5 text-xs text-gray-500">{option.sublabel}</p> : null}
                {option.imageAttribution ? (
                  <p className="line-clamp-1 pt-0.5 text-[10px] text-gray-400">{option.imageAttribution}</p>
                ) : null}
              </div>
            </button>
          )
        })}
      </div>

      <div className="flex items-center justify-between pt-3">
        <span className="text-xs text-gray-500">已选 {selectedIds.length} 项</span>
        <button
          type="button"
          disabled={disabled || selectedIds.length === 0}
          onClick={submit}
          className="rounded-full bg-brand-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-brand-500 disabled:opacity-50"
        >
          确认
        </button>
      </div>
    </CardShell>
  )
}

// ---------- 通用意见卡片（taskType=opinion） ----------

/** 稳定顺序标识 A/B/C…（超过字母表后回退为数字） */
function optionMarker(index: number): string {
  return index < 26 ? String.fromCharCode(65 + index) : String(index + 1)
}

/**
 * 意见/方案取舍题的文本优先选项卡：不渲染 3:4 封面、不加载
 * ResilientMapImage、不展示首字渐变占位或图片署名——那是作品选择卡的
 * 语义。单选保持点选后提交；多选勾选后确认；末位"自行输入"打开卡内
 * 输入框回传 { custom }。
 */
function OpinionChoiceAsk({ payload, multiple, disabled, onSubmit }: AskCardProps & { multiple: boolean }) {
  const options = payload.options ?? []
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [customOpen, setCustomOpen] = useState(false)
  const [customText, setCustomText] = useState('')
  const selected = useMemo(() => new Set(selectedIds), [selectedIds])

  const hasCustomOption = options.some(isAskCustomOption)
  const modelOptions = hasCustomOption ? options.filter((o) => !isAskCustomOption(o)) : options
  const customLabel = (options.find(isAskCustomOption) ?? reservedCustomOption()).label

  function pickSingle(option: AskUserOption) {
    if (disabled) return
    setSelectedIds([option.id])
    // 短暂延迟让选中态动画播完再提交（与作品卡一致）
    window.setTimeout(() => {
      onSubmit({ readableText: option.label, answerValue: { optionId: option.id } })
    }, 180)
  }

  function toggleMulti(option: AskUserOption) {
    if (disabled) return
    setSelectedIds((prev) => (prev.includes(option.id) ? prev.filter((id) => id !== option.id) : [...prev, option.id]))
  }

  function submitCustomSingle() {
    const text = customText.trim()
    if (!text) return
    onSubmit({ readableText: text, answerValue: { custom: text } })
  }

  function submitMulti() {
    const chosen = modelOptions.filter((o) => selected.has(o.id))
    const text = customText.trim()
    if (chosen.length === 0 && !text) return
    const readable = [...chosen.map((o) => o.label), ...(text ? [`自定义：${text}`] : [])].join('、')
    onSubmit({
      readableText: readable,
      answerValue: {
        ...(chosen.length ? { optionIds: chosen.map((o) => o.id) } : {}),
        ...(text ? { custom: text } : {}),
      },
    })
  }

  return (
    <CardShell prompt={payload.prompt} allowSkip={payload.allowSkip} disabled={disabled} onSubmit={onSubmit}>
      <div className="space-y-2">
        {modelOptions.map((option, idx) => {
          const isSelected = selected.has(option.id)
          return (
            <button
              key={option.id}
              type="button"
              disabled={disabled}
              aria-pressed={isSelected}
              onClick={() => (multiple ? toggleMulti(option) : pickSingle(option))}
              className={`flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition ${
                isSelected
                  ? 'border-transparent bg-brand-50 ring-1 ring-brand-400'
                  : 'border-gray-200 bg-white hover:border-brand-300'
              } disabled:opacity-60`}
            >
              <span
                aria-hidden
                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                  isSelected ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-500'
                }`}
              >
                {optionMarker(idx)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block break-words text-sm font-medium text-gray-900">{option.label}</span>
                {option.sublabel ? <span className="block break-words pt-0.5 text-xs text-gray-500">{option.sublabel}</span> : null}
              </span>
              {multiple && isSelected ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" /> : null}
            </button>
          )
        })}

        {/* 末位保留的"自行输入"选项（必须是最后一个选项）：打开卡内文本输入 */}
        <button
          type="button"
          disabled={disabled}
          aria-pressed={customOpen}
          onClick={() => (multiple ? setCustomOpen((v) => !v) : setCustomOpen(true))}
          className={`flex w-full items-center gap-3 rounded-xl border border-dashed px-3 py-2.5 text-left transition disabled:opacity-60 ${
            customOpen ? 'border-transparent bg-brand-50 ring-1 ring-brand-400' : 'border-gray-300 bg-white hover:border-brand-400'
          }`}
        >
          <span
            aria-hidden
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-100 text-brand-600"
          >
            <PenLine className="h-3 w-3" />
          </span>
          <span className="break-words text-sm text-gray-600">{customLabel}</span>
        </button>
      </div>

      {customOpen ? (
        <div className="flex items-center gap-2 pt-3">
          <input
            type="text"
            value={customText}
            disabled={disabled}
            autoFocus
            onChange={(e) => setCustomText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault()
                if (multiple) submitMulti()
                else submitCustomSingle()
              }
            }}
            placeholder={multiple ? '补充自定义内容（可与所选选项并存）' : '输入你的回答…'}
            className="min-w-0 flex-1 rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-brand-400"
          />
          <button
            type="button"
            disabled={disabled || !customText.trim()}
            onClick={() => (multiple ? submitMulti() : submitCustomSingle())}
            className="shrink-0 rounded-full bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-500 disabled:opacity-50"
          >
            {multiple ? '确认' : '提交'}
          </button>
        </div>
      ) : null}

      {multiple ? (
        <div className="flex items-center justify-between pt-3">
          <span className="text-xs text-gray-500">
            已选 {selectedIds.length} 项{customText.trim() ? ' + 自定义' : ''}
          </span>
          <button
            type="button"
            disabled={disabled || (selectedIds.length === 0 && !customText.trim())}
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
