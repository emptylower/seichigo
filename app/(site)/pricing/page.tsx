import type { Metadata } from 'next'
import PricingTemplate from '@/components/pricing/PricingTemplate'
import { t } from '@/lib/i18n'
import { buildZhAlternates } from '@/lib/seo/alternates'

export const metadata: Metadata = {
  title: t('pages.pricing.metaTitle', 'zh'),
  description: t('pages.pricing.metaDescription', 'zh'),
  alternates: buildZhAlternates({ path: '/pricing' }),
}

export const revalidate = 86400
export const dynamic = 'force-static'

export default function PricingPage() {
  return <PricingTemplate locale="zh" />
}
