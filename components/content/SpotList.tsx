"use client"
import React from 'react'

export type Spot = {
  id?: string
  order: number
  name?: string
  name_zh?: string
  name_ja?: string
  aliases?: string[]
  nearestStation_zh?: string
  nearestStation_ja?: string
  animeScene?: string
  googleMapsUrl?: string
  photoTip?: string
  etiquette?: string
  tags?: string[]
  note?: string
}

export default function SpotList({ spots }: { spots: Spot[] }) {
  const itemList =
    spots.length > 0
      ? {
          '@context': 'https://schema.org',
          '@type': 'ItemList',
          itemListOrder: 'http://schema.org/ItemListOrderAscending',
          itemListElement: spots.map((s) => {
            const nameZh = typeof s.name_zh === 'string' && s.name_zh.trim() ? s.name_zh.trim() : ''
            const fallback = typeof s.name === 'string' ? s.name.trim() : ''
            const label = nameZh || fallback || `Spot ${s.order}`
            const nameJa = typeof s.name_ja === 'string' && s.name_ja.trim() ? s.name_ja.trim() : ''
            const fullName = nameJa ? `${label}（${nameJa}）` : label
            const anchor = `#spot-${s.order}`
            return {
              '@type': 'ListItem',
              position: s.order,
              name: fullName,
              url: s.googleMapsUrl || anchor,
            }
          }),
        }
      : null

  return (
    <>
      {itemList ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(itemList) }}
        />
      ) : null}
      <ol className="space-y-3">
      {spots.map((s) => (
        <li key={s.order} id={`spot-${s.order}`} className="card">
          <div className="flex items-baseline justify-between">
            <h4 className="text-base font-semibold">
              {s.order}. {s.name_zh || s.name}
              {s.name_zh && s.name_ja ? `（${s.name_ja}）` : null}
            </h4>
            {s.googleMapsUrl ? (
              <a href={s.googleMapsUrl} target="_blank" rel="noreferrer" className="text-sm text-brand-600 hover:text-brand-700">在 Google Maps 打开</a>
            ) : null}
          </div>
          {s.animeScene ? <p className="mt-1 text-sm text-gray-600">动画场景：{s.animeScene}</p> : null}
          {s.note ? <p className="mt-1 text-sm text-gray-600">提示：{s.note}</p> : null}
        </li>
      ))}
      </ol>
    </>
  )
}
