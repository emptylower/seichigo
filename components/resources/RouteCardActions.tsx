'use client'

import CopyLinkButton from '@/components/resources/CopyLinkButton'

type Props = {
  routeHref: string
  primaryHref: string | null
}

export default function RouteCardActions({ routeHref, primaryHref }: Props) {
  return (
    <div
      className="flex flex-wrap items-center justify-end gap-2"
      onClick={(e) => {
        e.stopPropagation()
      }}
    >
      <CopyLinkButton
        path={routeHref}
        label="引用路线"
        className="inline-flex items-center justify-center rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 hover:text-gray-900 transition-colors whitespace-nowrap"
      />
      {primaryHref ? (
        <a
          href={primaryHref}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center rounded-lg bg-brand-500 px-3 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-600 transition-colors whitespace-nowrap"
        >
          打开地图
        </a>
      ) : null}
    </div>
  )
}
