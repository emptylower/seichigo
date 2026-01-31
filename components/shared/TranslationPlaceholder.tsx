'use client'

type TranslationPlaceholderProps = {
  locale: string
  className?: string
}

const messages: Record<string, string> = {
  en: 'This content is not yet available in English.',
  ja: 'このコンテンツはまだ日本語に翻訳されていません。',
  zh: '此内容暂无翻译',
}

export function TranslationPlaceholder({ locale, className = '' }: TranslationPlaceholderProps) {
  const message = messages[locale] || messages.zh

  return (
    <div className={`rounded-lg border border-amber-200 bg-amber-50 p-6 text-center ${className}`}>
      <svg
        className="mx-auto h-12 w-12 text-amber-400 mb-3"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129"
        />
      </svg>
      <p className="text-amber-800 font-medium">{message}</p>
    </div>
  )
}
