import type { Metadata } from 'next'
import LegalDocument from '@/components/legal/LegalDocument'
import { getHelpDocument } from '@/lib/help/content'
import { buildEnAlternates } from '@/lib/seo/alternates'

const document = getHelpDocument('en')
const title = 'Help Center | SeichiGo'
const description =
  'Learn how to find anime pilgrimage locations, read route information, submit corrections, and request copyright takedowns.'

export const metadata: Metadata = {
  title,
  description,
  alternates: buildEnAlternates({ zhPath: '/help' }),
  openGraph: { type: 'website', url: '/en/help', title, description, images: ['/opengraph-image'] },
  twitter: { card: 'summary_large_image', title, description, images: ['/twitter-image'] },
}

export const revalidate = 86400
export const dynamic = 'force-static'

export default function HelpEnPage() {
  return <LegalDocument document={document} />
}
