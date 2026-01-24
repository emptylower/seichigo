'use client'

import { useEffect } from 'react'
import { useSearchParams } from 'next/navigation'

function tryOpenRoute(routeKey: string) {
  const key = String(routeKey || '').trim()
  if (!key) return
  const el = document.querySelector(`details[data-route-key="${CSS.escape(key)}"]`) as HTMLDetailsElement | null
  if (el) el.open = true
}

function tryHighlightTarget(id: string) {
  const el = document.getElementById(id)
  if (!el) return
  el.classList.add('ring-2', 'ring-brand-200', 'bg-brand-50/50')
  window.setTimeout(() => {
    el.classList.remove('ring-2', 'ring-brand-200', 'bg-brand-50/50')
  }, 1600)
}

function scrollToHash() {
  const hash = String(window.location.hash || '').trim()
  if (!hash || hash === '#') return
  const id = hash.startsWith('#') ? hash.slice(1) : hash
  const el = document.getElementById(id)
  if (!el) return
  el.scrollIntoView({ block: 'start', behavior: 'smooth' })
  tryHighlightTarget(id)
}

export default function ResourcesDeepLinkRuntime() {
  const searchParams = useSearchParams()
  const route = searchParams.get('route')

  useEffect(() => {
    if (route) tryOpenRoute(route)

    const run = () => {
      const nextRoute = new URLSearchParams(window.location.search).get('route')
      if (nextRoute) tryOpenRoute(nextRoute)
      window.requestAnimationFrame(() => window.requestAnimationFrame(scrollToHash))
    }

    run()
    window.addEventListener('hashchange', run)
    window.addEventListener('popstate', run)
    return () => {
      window.removeEventListener('hashchange', run)
      window.removeEventListener('popstate', run)
    }
  }, [route])

  return null
}
