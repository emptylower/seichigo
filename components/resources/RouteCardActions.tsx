'use client'

import Link from 'next/link'
import CopyLinkButton from '@/components/resources/CopyLinkButton'

type Props = {
  articleHref: string
  routeHref: string
  primaryHref: string | null
}

export default function RouteCardActions({ articleHref, routeHref, primaryHref }: Props) {
  return (
    <div
      className="grid w-full grid-cols-3 gap-2"
      onClick={(e) => {
        e.stopPropagation()
      }}
    >
      <Link
        href={articleHref}
        className="inline-flex h-9 w-full items-center justify-center rounded-lg border border-gray-200 bg-white px-2 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 hover:text-gray-900"
      >
        阅读原文
      </Link>
      <CopyLinkButton
        path={routeHref}
        label="引用地图"
        className="inline-flex h-9 w-full items-center justify-center rounded-lg border border-gray-200 bg-white px-2 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 hover:text-gray-900 whitespace-nowrap"
      />
      {primaryHref ? (
        <a
          href={primaryHref}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-9 w-full items-center justify-center rounded-lg bg-brand-500 px-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-600 whitespace-nowrap"
        >
          打开地图
        </a>
      ) : (
        <span className="inline-flex h-9 w-full items-center justify-center rounded-lg bg-gray-100 px-2 text-sm font-semibold text-gray-400">
          打开地图
        </span>
      )}
    </div>
  )
}
