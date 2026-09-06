'use client'

import { useEffect, useRef } from 'react'
import { SendHorizontal, Square } from 'lucide-react'
import type { SupportedLocale } from '@/lib/i18n/types'
import { planTextFor } from '../lib/planText'

const TEXTAREA_MAX_HEIGHT_PX = 144 // ≈ 6 行（text-sm 20px 行高 + 上下 padding）

/**
 * 悬浮输入胶囊（从 ui.tsx 拆出，纯搬运）：包裹层只铺页面底色渐变（无边框、
 * 无整幅白块），胶囊本体圆角 + 描边 + 阴影；textarea 变高时只有胶囊变高。
 * 待回答的结构化提问在场时（answering=true）换一套 placeholder：直发内容
 * 会作为该 ask 的自定义回答回传。
 */
export function PlanComposer(props: {
  value: string
  onChange: (value: string) => void
  onSend: () => void
  busy: boolean
  /** 最后一条消息是待回答的 ask（placeholder 文案随之切换） */
  answering: boolean
  stopRequested: boolean
  onStop: () => void
  /** 「交给规划师调整」预填后需要聚焦——由 ui.tsx 持有 ref */
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>
  locale?: SupportedLocale
}) {
  const fallbackRef = useRef<HTMLTextAreaElement>(null)
  const textareaRef = props.textareaRef ?? fallbackRef
  const { value } = props
  const tx = planTextFor(props.locale ?? 'zh')

  // textarea 自适应高度（≤6 行，超出内部滚动）
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, TEXTAREA_MAX_HEIGHT_PX)}px`
  }, [value, textareaRef])

  return (
    <div className="sticky bottom-0 bg-gradient-to-t from-[#fff7fb] via-[#fff7fb]/80 to-transparent">
      <div className="mx-auto w-full max-w-3xl px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2">
        <div className="flex items-end gap-2 rounded-3xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
          <textarea
            ref={textareaRef}
            value={value}
            rows={1}
            onChange={(e) => props.onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                props.onSend()
              }
            }}
            placeholder={tx(props.answering ? 'composer.placeholderAnswer' : 'composer.placeholder')}
            className="max-h-36 flex-1 resize-none overflow-y-auto bg-transparent text-sm outline-none placeholder:text-gray-400"
          />
          {props.busy ? (
            <button
              type="button"
              aria-label={tx('composer.stop')}
              disabled={props.stopRequested}
              onClick={props.onStop}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-900 text-white transition hover:bg-gray-700 disabled:opacity-50"
            >
              <Square className="h-3.5 w-3.5 fill-current" />
            </button>
          ) : (
            <button
              type="button"
              aria-label={tx('composer.send')}
              disabled={!value.trim()}
              onClick={props.onSend}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white transition hover:bg-brand-500 disabled:opacity-50"
            >
              <SendHorizontal className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
