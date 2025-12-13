"use client"
import React from 'react'

export type Spot = {
  order: number
  name: string
  animeScene?: string
  note?: string
  googleMapsUrl?: string
}

export default function SpotList({ spots }: { spots: Spot[] }) {
  return (
    <ol className="space-y-3">
      {spots.map((s) => (
        <li key={s.order} className="card">
          <div className="flex items-baseline justify-between">
            <h4 className="text-base font-semibold">{s.order}. {s.name}</h4>
            {s.googleMapsUrl ? (
              <a href={s.googleMapsUrl} target="_blank" rel="noreferrer" className="text-sm text-brand-600 hover:text-brand-700">在 Google Maps 打开</a>
            ) : null}
          </div>
          {s.animeScene ? <p className="mt-1 text-sm text-gray-600">动画场景：{s.animeScene}</p> : null}
          {s.note ? <p className="mt-1 text-sm text-gray-600">提示：{s.note}</p> : null}
        </li>
      ))}
    </ol>
  )
}

