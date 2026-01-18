import { TocProps } from './types'

export default function TocPanel({ headings, activeId, onHeadingClick, className = '' }: TocProps) {
  if (headings.length === 0) return null

  return (
    <nav className={`text-sm ${className}`} aria-label="Table of Contents">
      <ul className="space-y-1">
        {headings.map((heading) => {
          const isActive = heading.id === activeId
          return (
            <li
              key={heading.id}
              style={{ paddingLeft: `${(heading.level - 1) * 12}px` }}
            >
              <button
                onClick={(e) => {
                  e.preventDefault()
                  onHeadingClick(heading)
                }}
                className={`block w-full text-left truncate py-1 px-2 rounded-md transition-colors duration-200 ${
                  isActive
                    ? 'text-brand-600 bg-brand-50 font-medium'
                    : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
                }`}
                title={heading.text}
              >
                {heading.text}
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
