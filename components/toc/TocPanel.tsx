import { TocProps } from './types'

export default function TocPanel({ headings, activeId, onHeadingClick, className = '' }: TocProps) {
  if (headings.length === 0) return null

  return (
    <nav className={`text-sm ${className}`} aria-label="Table of Contents">
      <div className="relative border-l border-gray-100 ml-0.5">
        <ul className="space-y-0.5">
          {headings.map((heading) => {
            const isActive = heading.id === activeId
            const paddingLeft = (Math.max(1, heading.level) - 1) * 12 + 12

            return (
              <li key={heading.id}>
                <button
                  onClick={(e) => {
                    e.preventDefault()
                    onHeadingClick(heading)
                  }}
                  className={`
                    group relative flex w-full text-left py-1.5 pr-2 -ml-px border-l-2 transition-all duration-200
                    ${
                      isActive
                        ? 'border-brand-600 text-brand-600 bg-gradient-to-r from-brand-50/50 to-transparent font-medium'
                        : 'border-transparent text-gray-500 hover:text-gray-900 hover:border-gray-300'
                    }
                  `}
                  style={{ paddingLeft: `${paddingLeft}px` }}
                  title={heading.text}
                >
                  <span className="block line-clamp-2 leading-relaxed">
                    {heading.text}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </nav>
  )
}
