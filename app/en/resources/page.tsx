import { getResourceRouteGroups } from '@/lib/resources/aggregateRoutes'
import { buildEnAlternates } from '@/lib/seo/alternates'
import RouteDirectory from '@/components/resources/RouteDirectory'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Resources — route maps',
  description:
    'Grouped route maps extracted from published posts. Each route and spot is linkable for referencing and sharing.',
  alternates: buildEnAlternates({ zhPath: '/resources' }),
  openGraph: {
    type: 'website',
    url: '/en/resources',
    title: 'Resources',
    description:
      'Grouped route maps extracted from published posts. Each route and spot is linkable for referencing and sharing.',
    images: ['/opengraph-image'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Resources',
    description:
      'Grouped route maps extracted from published posts. Each route and spot is linkable for referencing and sharing.',
    images: ['/twitter-image'],
  },
}

export const dynamic = 'force-dynamic'

export default async function ResourcesIndexEnPage() {
  const groups = await getResourceRouteGroups()

  return (
    <div>
      <h1 className="text-2xl font-bold">Resources</h1>
      <div className="mt-2 text-sm text-gray-600">Grouped route maps extracted from published posts. Each route/spot has a link.</div>

      <div className="mt-6">
        <RouteDirectory groups={groups} locale="en" />
      </div>
    </div>
  )
}
