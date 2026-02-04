import React from 'react'
import { serializeJsonLd } from '@/lib/seo/jsonld'

type JsonLd = Record<string, unknown>

type Props = {
  /** JSON-LD object or array of objects. null/undefined/empty arrays render nothing. */
  data?: JsonLd | JsonLd[] | null
  /** Optional key prefix for React keys. */
  keyPrefix?: string
}

function asArray(data: Props['data']): JsonLd[] {
  if (!data) return []
  return Array.isArray(data) ? data : [data]
}

/**
 * Server-safe JSON-LD placement helper.
 * Renders <script type="application/ld+json"> tags with safe serialization.
 */
export default function PlaceJsonLd({ data, keyPrefix = 'jsonld' }: Props) {
  const items = asArray(data).filter(Boolean)
  if (!items.length) return null

  return (
    <>
      {items.map((obj, idx) => (
        <script
          key={`${keyPrefix}-${String((obj as any)['@type'] || 'schema')}-${idx}`}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(obj) }}
        />
      ))}
    </>
  )
}
