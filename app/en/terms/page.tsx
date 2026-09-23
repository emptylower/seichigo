import { pageCardImage } from '@/lib/og/pageCardUrl'
import type { Metadata } from 'next'
import LegalDocument from '@/components/legal/LegalDocument'
import { getLegalDocument } from '@/lib/legal/content'
import { buildEnAlternates } from '@/lib/seo/alternates'

const document = getLegalDocument('terms', 'en')

export const metadata: Metadata = {
  title: 'Terms of Service | SeichiGo',
  description: 'Read SeichiGo Terms of Service covering account usage, user content, moderation, and liability limitations.',
  alternates: buildEnAlternates({ zhPath: '/terms' }),
  openGraph: {
    type: 'website',
    url: '/en/terms',
    title: 'Terms of Service | SeichiGo',
    description: 'Read SeichiGo Terms of Service covering account usage, user content, moderation, and liability limitations.',
    images: [pageCardImage('site', 'home', 'en', 'SeichiGo Anime Pilgrimage')],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Terms of Service | SeichiGo',
    description: 'Read SeichiGo Terms of Service covering account usage, user content, moderation, and liability limitations.',
    images: [pageCardImage('site', 'home', 'en', 'SeichiGo Anime Pilgrimage')],
  },
}

export const revalidate = 86400
export const dynamic = 'force-static'

export default function TermsEnPage() {
  return <LegalDocument document={document} />
}
