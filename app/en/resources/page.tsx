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
      <div className="py-12 text-center">
        <h1 className="text-3xl font-bold tracking-tight text-gray-900 md:text-4xl">Resources</h1>
        <div className="mx-auto mt-4 max-w-2xl text-lg text-gray-500">
          Grouped route maps extracted from published posts.
          <br className="hidden sm:inline" />
          Each route and spot is linkable for referencing and sharing.
        </div>
      </div>

      <div className="mt-8">
        <RouteDirectory groups={groups} locale="en" />
      </div>
    </div>
  )
}
