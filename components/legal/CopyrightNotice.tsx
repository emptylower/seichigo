import Link from 'next/link'
import type { SiteLocale } from '@/components/layout/SiteShell'
import { prefixPath } from '@/components/layout/prefixPath'

const TEXT: Record<SiteLocale, { body: string; linkLabel: string }> = {
  zh: {
    body: '本文中的动画画面版权归各自著作权人所有，仅在场景对照与说明的必要范围内引用；实景照片版权归拍摄者所有。',
    linkLabel: '版权与下架申请',
  },
  en: {
    body: 'Anime frames in this article remain the property of their respective copyright holders and are quoted only as needed for scene comparison and commentary. Photographs remain the property of the photographer.',
    linkLabel: 'Copyright and takedown requests',
  },
  ja: {
    body: '本記事中のアニメ画面の著作権はそれぞれの権利者に帰属し、場面の対比と解説に必要な範囲で引用しています。実景写真の著作権は撮影者に帰属します。',
    linkLabel: '著作権と削除依頼',
  },
}

export default function CopyrightNotice({ locale = 'zh' }: { locale?: SiteLocale }) {
  const text = TEXT[locale]

  return (
    <aside className="not-prose mt-12 rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 text-xs leading-6 text-gray-500">
      <p>{text.body}</p>
      <Link href={prefixPath('/help', locale)} prefetch={false} className="mt-1 inline-block text-brand-600 hover:underline">
        {text.linkLabel}
      </Link>
    </aside>
  )
}
