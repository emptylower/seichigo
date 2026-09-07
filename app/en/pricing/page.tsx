import type { Metadata } from 'next'
import PricingTemplate from '@/components/pricing/PricingTemplate'
import { t } from '@/lib/i18n'
import { buildEnAlternates } from '@/lib/seo/alternates'

export const metadata: Metadata = {
  title: t('pages.pricing.metaTitle', 'en'),
  description: t('pages.pricing.metaDescription', 'en'),
  alternates: buildEnAlternates({ zhPath: '/pricing' }),
}

export const revalidate = 86400
export const dynamic = 'force-static'

export default function PricingEnPage() {
  return <PricingTemplate locale="en" />
}
