"use client"

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import TocPanel from './TocPanel'
import TocDrawer from './TocDrawer'
import { useTocObserver } from './useTocObserver'
import type { TocHeading } from './types'

const TOC_ROOT_SELECTOR = '[data-seichi-article-content="true"]'
const HEADING_SELECTOR = 'h1, h2, h3'
const SCROLL_OFFSET = 96

function hashHeadingText(input: string): string {
  let hash = 0
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0
  }
  return Math.abs(hash).toString(36)
}

function buildHeadingId(text: string, index: number): string {
  const normalized = text.trim().toLowerCase() || 'heading'
  return `toc-${hashHeadingText(normalized)}-${index}`
}

export default function ArticleToc() {
  const [headings, setHeadings] = useState<TocHeading[]>([])
  const activeId = useTocObserver(headings, SCROLL_OFFSET)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [isCollapsed, setIsCollapsed] = useState(false)
  const pathname = usePathname()

  useEffect(() => {
    const root = document.querySelector(TOC_ROOT_SELECTOR)
    if (!root) return

    const elements = Array.from(root.querySelectorAll(HEADING_SELECTOR)) as HTMLElement[]
    const usedIds = new Set<string>()
    const nextHeadings: TocHeading[] = []

    elements.forEach((el, index) => {
      const text = el.textContent || ''
      const level = Number(el.tagName.charAt(1)) || 1
      const id = buildHeadingId(text, index)

      if (!el.id || usedIds.has(el.id)) {
        el.id = id
      }

      usedIds.add(el.id)
      el.style.scrollMarginTop = `${SCROLL_OFFSET}px`

      nextHeadings.push({
        id: el.id,
        text,
        level,
      })
    })

    setHeadings(nextHeadings)
  }, [pathname])

  const handleHeadingClick = (h: TocHeading) => {
    const el = document.getElementById(h.id)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  if (headings.length === 0) return null

  return (
    <>
      <div
        className={`hidden xl:flex flex-col relative transition-all duration-300 ease-in-out overflow-hidden ${
          isCollapsed ? 'w-10' : 'w-64'
        }`}
      >
        <div className={`flex items-center ${isCollapsed ? 'justify-center' : 'justify-between'} mb-4 h-8 shrink-0`}>
          {!isCollapsed && (
            <h3 className="text-lg font-bold text-gray-900 pl-1">
              目录
            </h3>
          )}
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="p-1.5 rounded-md text-gray-500 hover:text-brand-600 hover:bg-brand-50 transition-colors"
            title={isCollapsed ? '展开目录' : '收起目录'}
            aria-label={isCollapsed ? '展开目录' : '收起目录'}
          >
            {isCollapsed ? (
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            ) : (
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            )}
          </button>
        </div>

        <div
          className={`overflow-y-auto max-h-[calc(100vh-8rem)] pr-2 transition-opacity duration-200 min-w-[16rem] ${
            isCollapsed ? 'opacity-0 pointer-events-none' : 'opacity-100'
          }`}
        >
          <TocPanel headings={headings} activeId={activeId} onHeadingClick={handleHeadingClick} />
        </div>
      </div>

      <div className="fixed bottom-6 right-6 z-40 xl:hidden">
        <button
          onClick={() => setDrawerOpen(true)}
          className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-gray-700 shadow-lg border border-gray-200 active:scale-95 transition-transform"
          aria-label="打开目录"
        >
          <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h7" />
          </svg>
        </button>
      </div>

      <TocDrawer
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        headings={headings}
        activeId={activeId}
        onHeadingClick={handleHeadingClick}
      />
    </>
  )
}
