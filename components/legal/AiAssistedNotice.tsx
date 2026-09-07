import Link from 'next/link'
import type { SiteLocale } from '@/components/layout/SiteShell'
import { prefixPath } from '@/components/layout/prefixPath'

const TEXT: Record<SiteLocale, { before: string; linkLabel: string; after: string }> = {
  zh: {
    before: '本文由 AI 辅助整理，实地信息持续校对中。发现有误请通过',
    linkLabel: '帮助中心',
    after: '反馈。',
  },
  en: {
    before:
      'This article was prepared with AI assistance; on-site details are being verified and updated. Spotted an error? Let us know via the ',
    linkLabel: 'Help Center',
    after: '.',
  },
  ja: {
    before: 'この記事は AI の補助で作成しており、現地情報は継続的に確認・更新しています。誤りにお気づきの際は',
    linkLabel: 'ヘルプセンター',
    after: 'からお知らせください。',
  },
}

export default function AiAssistedNotice({ locale = 'zh' }: { locale?: SiteLocale }) {
  const text = TEXT[locale]

  return (
    <aside className="not-prose mt-6 rounded-lg border-l-2 border-brand-200 bg-gray-50 px-4 py-2 text-xs leading-6 text-gray-500">
      <p>
        {text.before}
        <Link href={prefixPath('/help', locale)} prefetch={false} className="text-brand-600 hover:underline">
          {text.linkLabel}
        </Link>
        {text.after}
      </p>
    </aside>
  )
}
