import { buildOrganizationJsonLd, buildWebSiteJsonLd } from '@/lib/seo/globalJsonLd'

export default function Head() {
  const jsonLds = [buildWebSiteJsonLd(), buildOrganizationJsonLd()]

  return (
    <>
      {jsonLds.map((obj, idx) => (
        <script
          key={`${String(obj['@type'] || 'jsonld')}-${idx}`}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(obj) }}
        />
      ))}
    </>
  )
}
