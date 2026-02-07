import type { Metadata } from 'next'
import LegalDocument from '@/components/legal/LegalDocument'
import { getLegalDocument } from '@/lib/legal/content'
import { buildEnAlternates } from '@/lib/seo/alternates'

const document = getLegalDocument('privacy', 'en')

export const metadata: Metadata = {
  title: 'Privacy Policy | SeichiGo',
  description: 'Learn how SeichiGo handles personal data for authentication, submissions, comments, favorites, and analytics.',
  alternates: buildEnAlternates({ zhPath: '/privacy' }),
  openGraph: {
    type: 'website',
    url: '/en/privacy',
    title: 'Privacy Policy | SeichiGo',
    description: 'Learn how SeichiGo handles personal data for authentication, submissions, comments, favorites, and analytics.',
    images: ['/opengraph-image'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Privacy Policy | SeichiGo',
    description: 'Learn how SeichiGo handles personal data for authentication, submissions, comments, favorites, and analytics.',
    images: ['/twitter-image'],
  },
}

export const revalidate = 86400
export const dynamic = 'force-static'

export default function PrivacyEnPage() {
  return <LegalDocument document={document} />
}
