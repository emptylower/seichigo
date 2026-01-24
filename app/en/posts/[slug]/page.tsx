import type { Metadata } from 'next'
import { permanentRedirect } from 'next/navigation'

export const revalidate = 3600

export function generateMetadata(): Metadata {
  return {
    title: 'Redirecting',
    robots: { index: false, follow: false },
  }
}

export default async function EnPostRedirectPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const raw = String(slug || '').trim()
  permanentRedirect(`/posts/${encodeURIComponent(raw)}`)
}
