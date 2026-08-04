import type { Metadata } from 'next'
import LegalDocument from '@/components/legal/LegalDocument'
import { getStatusDocument } from '@/lib/help/content'
import { buildEnAlternates } from '@/lib/seo/alternates'

const document = getStatusDocument('en')
const title = 'System Status | SeichiGo'
const description = 'View the current status, known issues, incident history, and planned maintenance for SeichiGo services.'

export const metadata: Metadata = {
  title,
  description,
  alternates: buildEnAlternates({ zhPath: '/status' }),
  openGraph: { type: 'website', url: '/en/status', title, description, images: ['/opengraph-image'] },
  twitter: { card: 'summary_large_image', title, description, images: ['/twitter-image'] },
}

export const revalidate = 86400
export const dynamic = 'force-static'

export default function StatusEnPage() {
  return <LegalDocument document={document} />
}
