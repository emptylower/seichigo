import { useEffect, useMemo, useState } from 'react'
import type { TocHeading } from './types'

const DEFAULT_OFFSET = 96

export function useTocObserver(headings: TocHeading[], offset: number = DEFAULT_OFFSET) {
  const [activeId, setActiveId] = useState<string | null>(null)
  const ids = useMemo(() => headings.map((heading) => heading.id), [headings])

  useEffect(() => {
    if (!ids.length) {
      setActiveId(null)
      return
    }

    let rafId = 0

    const resolveActive = () => {
      const elements = ids
        .map((id) => document.getElementById(id))
        .filter((el): el is HTMLElement => Boolean(el))

      if (!elements.length) {
        setActiveId(null)
        return
      }

      const scrollY = window.scrollY + offset + 1
      let currentId: string | null = null

      for (const heading of elements) {
        if (scrollY >= heading.offsetTop) {
          currentId = heading.id
        } else {
          break
        }
      }

      setActiveId(currentId)
    }

    const handleScroll = () => {
      if (rafId) return
      rafId = window.requestAnimationFrame(() => {
        rafId = 0
        resolveActive()
      })
    }

    window.addEventListener('scroll', handleScroll, { passive: true })
    window.addEventListener('resize', handleScroll)
    resolveActive()

    return () => {
      window.removeEventListener('scroll', handleScroll)
      window.removeEventListener('resize', handleScroll)
      if (rafId) window.cancelAnimationFrame(rafId)
    }
  }, [ids, offset])

  return activeId
}
