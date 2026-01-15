import Link from 'next/link'

export type BreadcrumbItem = { name: string; href: string }

export default function Breadcrumbs({ items }: { items: BreadcrumbItem[] }) {
  if (!items.length) return null
  return (
    <nav aria-label="Breadcrumb" className="text-sm text-gray-500">
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {items.map((item, idx) => {
          const isLast = idx === items.length - 1
          return (
            <li key={`${item.href}-${idx}`} className="flex items-center gap-x-2">
              {idx > 0 ? <span className="text-gray-300">/</span> : null}
              {isLast ? (
                <span aria-current="page" className="text-gray-700">
                  {item.name}
                </span>
              ) : (
                <Link href={item.href} className="hover:underline">
                  {item.name}
                </Link>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

