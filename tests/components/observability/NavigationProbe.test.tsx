import React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, fireEvent, render } from '@testing-library/react'
import NavigationProbe from '@/components/observability/NavigationProbe.client'

let mockPathname = '/from'
const captureEventMock = vi.fn()

vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}))

vi.mock('@sentry/nextjs', () => ({
  captureEvent: (...args: unknown[]) => captureEventMock(...args),
}))

describe('NavigationProbe', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mockPathname = '/from'
    window.history.pushState({}, '', '/from')
    vi.spyOn(Math, 'random').mockReturnValue(0.01)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('captures nav_click fields for internal links', () => {
    const { getByRole } = render(
      <>
        <NavigationProbe />
        <details>
          <summary>
            <a href="/to?ref=abc" data-nav-surface="resources-card-actions" onClick={(e) => e.preventDefault()}>go</a>
          </summary>
        </details>
      </>
    )

    fireEvent.click(getByRole('link', { name: 'go' }))

    const clickEvent = captureEventMock.mock.calls
      .map(([event]) => event as any)
      .find((event) => event?.message === 'nav_click')

    expect(clickEvent).toBeTruthy()
    expect(clickEvent.extra.from_path).toBe('/from')
    expect(clickEvent.extra.to_path).toBe('/to')
    expect(clickEvent.extra.surface).toBe('resources-card-actions')
    expect(clickEvent.extra.inside_summary).toBe(true)
    expect(clickEvent.extra.details_open).toBe(false)
    expect(clickEvent.extra.session_sampled).toBe(true)
  })

  it('captures nav_repeat_click even when session is not sampled', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99)

    const { getByRole } = render(
      <>
        <NavigationProbe />
        <a href="/to" data-nav-surface="resources-card-actions" onClick={(e) => e.preventDefault()}>to</a>
      </>
    )

    const link = getByRole('link', { name: 'to' })
    fireEvent.click(link)
    fireEvent.click(link)

    const repeatEvent = captureEventMock.mock.calls
      .map(([event]) => event as any)
      .find((event) => event?.message === 'nav_repeat_click')

    expect(repeatEvent).toBeTruthy()
    expect(repeatEvent.extra.session_sampled).toBe(false)
    expect(repeatEvent.extra.to_path).toBe('/to')
  })

  it('captures nav_stall after threshold when route does not complete', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99)

    const { getByRole } = render(
      <>
        <NavigationProbe />
        <a href="/to" onClick={(e) => e.preventDefault()}>to</a>
      </>
    )

    fireEvent.click(getByRole('link', { name: 'to' }))

    act(() => {
      vi.advanceTimersByTime(1200)
    })

    const stallEvent = captureEventMock.mock.calls
      .map(([event]) => event as any)
      .find((event) => event?.message === 'nav_stall')

    expect(stallEvent).toBeTruthy()
    expect(stallEvent.extra.to_path).toBe('/to')
    expect(stallEvent.extra.duration_ms).toBeGreaterThanOrEqual(1200)
  })

  it('captures nav_success when pathname changes to target route', () => {
    const view = render(
      <>
        <NavigationProbe />
        <a href="/to" onClick={(e) => e.preventDefault()}>to</a>
      </>
    )

    fireEvent.click(view.getByRole('link', { name: 'to' }))

    mockPathname = '/to'
    act(() => {
      view.rerender(
        <>
          <NavigationProbe />
          <a href="/to" onClick={(e) => e.preventDefault()}>to</a>
        </>
      )
    })

    const successEvent = captureEventMock.mock.calls
      .map(([event]) => event as any)
      .find((event) => event?.message === 'nav_success')

    expect(successEvent).toBeTruthy()
    expect(successEvent.extra.to_path).toBe('/to')
    expect(successEvent.extra.duration_ms).toBeGreaterThanOrEqual(0)
  })
})
