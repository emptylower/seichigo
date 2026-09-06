import type { Metadata } from 'next'
import PricingTemplate from '@/components/pricing/PricingTemplate'
import { t } from '@/lib/i18n'
import { buildJaAlternates } from '@/lib/seo/alternates'

export const metadata: Metadata = {
  title: t('pages.pricing.metaTitle', 'ja'),
  description: t('pages.pricing.metaDescription', 'ja'),
  alternates: buildJaAlternates({ zhPath: '/pricing' }),
}

export const revalidate = 86400
export const dynamic = 'force-static'

export default function PricingJaPage() {
  return <PricingTemplate locale="ja" />
}
