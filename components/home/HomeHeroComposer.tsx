'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight } from 'lucide-react'
import type { SiteLocale } from '@/components/layout/SiteShell'
import { planStartHref } from './planStartHref'
import { useTypewriterPlaceholder } from './HomeHeroTypewriter'
import { usePrefersReducedMotion } from './usePrefersReducedMotion'

/** 把输入和逐字占位更新留在表单内，避免每个字符都重新渲染整个首屏。 */
export default function HomeHeroComposer({
  locale,
  submitLabel,
  staticPlaceholder,
  examples,
}: {
  locale: SiteLocale
  submitLabel: string
  staticPlaceholder: string
  examples: string[]
}) {
  const router = useRouter()
  const reduced = usePrefersReducedMotion()
  const [text, setText] = useState('')
  const [focused, setFocused] = useState(false)
  const typed = useTypewriterPlaceholder(examples, { enabled: !reduced && !focused && !text })
  const placeholder = reduced ? examples[0] || staticPlaceholder : typed || staticPlaceholder

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const draft = text.trim()
    if (!draft) return
    router.push(planStartHref(locale, draft))
  }

  return (
    <>
      <form
        aria-label={submitLabel}
        onSubmit={handleSubmit}
        className="flex flex-col gap-2 rounded-2xl border border-gray-200 bg-white p-2 shadow-lg focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-200 sm:flex-row sm:items-center"
      >
        <input
          type="text"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          // 输入法组词期间的回车是「上屏」，不能触发表单提交。
          onKeyDown={(event) => {
            if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault()
          }}
          placeholder={placeholder}
          className="w-full flex-1 rounded-xl px-3 py-3 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none"
        />
        <button
          type="submit"
          className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl bg-brand-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-700"
        >
          {submitLabel}
          <ArrowRight className="h-4 w-4" />
        </button>
      </form>

      {/* 移动端优先：chip 横向滚动，不换行挤压输入框。 */}
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
        {examples.map((example) => (
          <button
            key={example}
            type="button"
            onClick={() => setText(example)}
            className="shrink-0 rounded-full border border-white/70 bg-white/70 px-3 py-1.5 text-xs text-gray-600 backdrop-blur-sm transition-colors hover:border-brand-300 hover:bg-white hover:text-brand-600"
          >
            {example}
          </button>
        ))}
      </div>
    </>
  )
}
