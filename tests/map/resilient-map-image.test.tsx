import React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ResilientMapImage from '@/components/map/ResilientMapImage'
import { createCompleteModeTrackedMetricCallbacks } from '@/features/map/anitabi/completeModeDiagnostics'
import {
  recordHostFailure,
  resetDegradedMapImageHostsForTest,
} from '@/components/map/utils/mapImageHostPolicy'
import {
  acquireMapImageRequestSlot,
  resetMapImageRequestSchedulerForTest,
} from '@/features/map/anitabi/mapImageRequestScheduler'

const BREAKER_FLAG = 'NEXT_PUBLIC_MAP_IMAGE_BREAKER_V2_ENABLED'

describe('ResilientMapImage', () => {
  const originalBreakerFlag = process.env[BREAKER_FLAG]

  beforeEach(() => {
    resetDegradedMapImageHostsForTest()
    resetMapImageRequestSchedulerForTest()
    delete process.env[BREAKER_FLAG]
  })

  afterEach(() => {
    resetDegradedMapImageHostsForTest()
    if (originalBreakerFlag === undefined) {
      delete process.env[BREAKER_FLAG]
      return
    }
    process.env[BREAKER_FLAG] = originalBreakerFlag
  })

  it('retries once with a retry nonce before falling back', async () => {
    render(
      <ResilientMapImage
        src="https://lain.bgm.tv/pic/cover/l/b8/0d/513345_jv4wM.jpg"
        alt="cover"
        kind="cover"
        fallback={<div>fallback</div>}
      />
    )

    const img = await screen.findByAltText('cover') as HTMLImageElement
    expect(decodeURIComponent(img.src)).toContain('/pic/cover/m/')
    expect(img.src).not.toContain('_retry=1')

    fireEvent.error(img)
    const retried = await screen.findByAltText('cover') as HTMLImageElement
    expect(retried.src).toContain('_retry=1')

    fireEvent.error(retried)
    expect(screen.getByText('fallback')).toBeInTheDocument()
  })

  it('emits diagnostic request and terminal callbacks for DOM image slots', async () => {
    const requestStart = vi.fn()
    const terminal = vi.fn()

    render(
      <ResilientMapImage
        src="https://www.anitabi.cn/images/user/0/a.jpg"
        alt="point"
        kind="point"
        diagnosticSurface="map"
        diagnosticSlotKey="preview-point-1"
        onDiagnosticRequestStart={(input) => {
          requestStart(input)
          return {
            requestUrl: `${input.requestedCandidateUrl}?__mi_request=req-1`,
            requestId: 'req-1',
          }
        }}
        onDiagnosticRequestTerminal={terminal}
        fallback={<div>fallback</div>}
      />
    )

    const img = await screen.findByAltText('point')
    expect(requestStart).toHaveBeenCalledTimes(1)
    const firstRequestStartCall = requestStart.mock.calls.at(0) as any[] | undefined
    expect(firstRequestStartCall?.[0]).toMatchObject({
      slotKey: 'preview-point-1',
    })
    expect(img.getAttribute('src')).toContain('__mi_request=req-1')

    fireEvent.load(img)
    const firstTerminalCall = terminal.mock.calls.at(0) as any[] | undefined
    expect(firstTerminalCall?.[0]).toMatchObject({
      handle: { requestId: 'req-1' },
      terminalState: 'succeeded',
      displayOutcome: 'visible',
    })
  })

  it('does not retry a DOM image after it has already loaded successfully', async () => {
    vi.useFakeTimers()
    try {
      const requestStart = vi.fn((input) => ({
        requestUrl: `${input.requestedCandidateUrl}?__mi_request=1`,
        requestId: 'req-1',
      }))
      const terminal = vi.fn()

      render(
        <ResilientMapImage
          src="https://image.anitabi.cn/points/1/a.jpg?w=640&q=80"
          alt="loaded-preview"
          kind="point-preview"
          diagnosticSurface="map"
          diagnosticSlotKey="preview-loaded"
          onDiagnosticRequestStart={requestStart}
          onDiagnosticRequestTerminal={terminal}
          fallback={<div>fallback</div>}
        />,
      )

      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })

      const img = screen.getByAltText('loaded-preview') as HTMLImageElement
      fireEvent.load(img)

      await act(async () => {
        vi.advanceTimersByTime(6001)
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(requestStart).toHaveBeenCalledTimes(1)
      expect(terminal).toHaveBeenCalledTimes(1)
      expect(terminal.mock.calls[0]?.[0]).toMatchObject({
        handle: { requestId: 'req-1' },
        terminalState: 'succeeded',
        displayOutcome: 'visible',
      })
      expect(screen.getByAltText('loaded-preview')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('closes the previous diagnostic handle when src is replaced on the same instance', async () => {
    let counter = 0
    const requestStart = vi.fn((input) => {
      counter += 1
      return {
        requestUrl: `${input.requestedCandidateUrl}?__mi_request=${counter}`,
        requestId: `req-${counter}`,
      }
    })
    const terminal = vi.fn()

    const { rerender } = render(
      <ResilientMapImage
        src="https://image.anitabi.cn/points/1/a.jpg?w=640&q=80"
        alt="preview"
        kind="point-preview"
        diagnosticSurface="map"
        diagnosticSlotKey="preview-p1"
        onDiagnosticRequestStart={requestStart}
        onDiagnosticRequestTerminal={terminal}
        fallback={<div>fallback</div>}
      />,
    )

    await screen.findByAltText('preview')

    rerender(
      <ResilientMapImage
        src="https://image.anitabi.cn/points/1/b.jpg?w=640&q=80"
        alt="preview"
        kind="point-preview"
        diagnosticSurface="map"
        diagnosticSlotKey="preview-p2"
        onDiagnosticRequestStart={requestStart}
        onDiagnosticRequestTerminal={terminal}
        fallback={<div>fallback</div>}
      />,
    )

    await screen.findByAltText('preview')
    expect(requestStart).toHaveBeenCalledTimes(2)
    expect(terminal).toHaveBeenCalledWith(
      expect.objectContaining({
        handle: { requestId: 'req-1', requestUrl: expect.stringContaining('__mi_request=1') },
        terminalState: 'superseded',
        outcome: 'source_replaced',
      }),
    )
  })

  it('does not restart the request when only diagnostic callback identities change', async () => {
    const requestStart1 = vi.fn((input) => ({
      requestUrl: `${input.requestedCandidateUrl}?__mi_request=1`,
      requestId: 'req-1',
    }))
    const terminal1 = vi.fn()

    const { rerender } = render(
      <ResilientMapImage
        src="https://image.anitabi.cn/points/1/a.jpg?w=640&q=80"
        alt="stable-preview"
        kind="point-preview"
        diagnosticSurface="map"
        diagnosticSlotKey="preview-stable"
        onDiagnosticRequestStart={requestStart1}
        onDiagnosticRequestTerminal={terminal1}
        fallback={<div>fallback</div>}
      />,
    )

    const firstImg = await screen.findByAltText('stable-preview')
    expect(firstImg.getAttribute('src')).toContain('__mi_request=1')
    expect(requestStart1).toHaveBeenCalledTimes(1)

    const requestStart2 = vi.fn((input) => ({
      requestUrl: `${input.requestedCandidateUrl}?__mi_request=2`,
      requestId: 'req-2',
    }))
    const terminal2 = vi.fn()

    rerender(
      <ResilientMapImage
        src="https://image.anitabi.cn/points/1/a.jpg?w=640&q=80"
        alt="stable-preview"
        kind="point-preview"
        diagnosticSurface="map"
        diagnosticSlotKey="preview-stable"
        onDiagnosticRequestStart={requestStart2}
        onDiagnosticRequestTerminal={terminal2}
        fallback={<div>fallback</div>}
      />,
    )

    const stableImg = await screen.findByAltText('stable-preview')
    expect(stableImg.getAttribute('src')).toContain('__mi_request=1')
    expect(requestStart2).not.toHaveBeenCalled()
    expect(terminal1).not.toHaveBeenCalledWith(
      expect.objectContaining({
        terminalState: 'aborted',
      }),
    )
    expect(terminal2).not.toHaveBeenCalled()
  })

  it('closes the active retry-chain handle when src is replaced after an error path', async () => {
    let counter = 0
    const requestStart = vi.fn((input) => {
      counter += 1
      return {
        requestUrl: `${input.requestedCandidateUrl}?__mi_request=${counter}`,
        requestId: `req-${counter}`,
      }
    })
    const terminal = vi.fn()

    const { rerender } = render(
      <ResilientMapImage
        src="https://image.anitabi.cn/points/1/a.jpg?w=640&q=80"
        alt="preview"
        kind="point-preview"
        diagnosticSurface="map"
        diagnosticSlotKey="preview-p1"
        onDiagnosticRequestStart={requestStart}
        onDiagnosticRequestTerminal={terminal}
        fallback={<div>fallback</div>}
      />,
    )

    const img = await screen.findByAltText('preview')
    await act(async () => {
      fireEvent.error(img)
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(requestStart).toHaveBeenCalledTimes(2)

    rerender(
      <ResilientMapImage
        src="https://image.anitabi.cn/points/1/b.jpg?w=640&q=80"
        alt="preview"
        kind="point-preview"
        diagnosticSurface="map"
        diagnosticSlotKey="preview-p2"
        onDiagnosticRequestStart={requestStart}
        onDiagnosticRequestTerminal={terminal}
        fallback={<div>fallback</div>}
      />,
    )

    await waitFor(() => {
      expect(requestStart).toHaveBeenCalledTimes(3)
    })
    expect(terminal).toHaveBeenCalledWith(
      expect.objectContaining({
        handle: { requestId: 'req-2', requestUrl: expect.stringContaining('__mi_request=2') },
        terminalState: 'superseded',
        outcome: 'source_replaced',
      }),
    )
  })

  it('falls back from direct anitabi bangumi cover to proxy on error', async () => {
    render(
      <ResilientMapImage
        src="https://www.anitabi.cn/bangumi/290980.jpg"
        alt="bangumi"
        kind="cover"
        fallback={<div>fallback</div>}
      />
    )

    const img = await screen.findByAltText('bangumi') as HTMLImageElement
    expect(img.src).toBe('https://image.anitabi.cn/bangumi/290980.jpg')

    fireEvent.error(img)
    const directRetryCandidate = await screen.findByAltText('bangumi') as HTMLImageElement
    expect(directRetryCandidate.src).toBe('https://image.anitabi.cn/bangumi/290980.jpg?_retry=1')

    fireEvent.error(directRetryCandidate)
    const proxyFallbackCandidate = await screen.findByAltText('bangumi') as HTMLImageElement
    expect(decodeURIComponent(proxyFallbackCandidate.src)).toContain('/api/anitabi/image-render?url=https://image.anitabi.cn/bangumi/290980.jpg')
  })

  it('starts point-photo previews on the proxy lane and retries the proxy once', async () => {
    render(
      <ResilientMapImage
        src="https://image.anitabi.cn/points/217249/db2c913d_1754363336601.jpg?w=640&q=80"
        alt="point-preview"
        kind="point"
        fallback={<div>fallback</div>}
      />
    )

    const img = await screen.findByAltText('point-preview') as HTMLImageElement
    expect(decodeURIComponent(img.src)).toContain(
      '/api/anitabi/image-render?url=https://image.anitabi.cn/points/217249/db2c913d_1754363336601.jpg?w=640&q=80',
    )

    fireEvent.error(img)
    const proxyRetryCandidate = await screen.findByAltText('point-preview') as HTMLImageElement
    expect(decodeURIComponent(proxyRetryCandidate.src)).toContain(
      '/api/anitabi/image-render?url=https://image.anitabi.cn/points/217249/db2c913d_1754363336601.jpg?w=640&q=80&_retry=1',
    )
  })

  it('resolves complete-mode surface at request time instead of loader-construction time', () => {
    const startRequest = vi.fn()
    const managerRef = {
      current: {
        startRequest,
        finishRequest: vi.fn(),
      },
    }
    let surface: 'map' | 'nearby' = 'map'
    const callbacks = createCompleteModeTrackedMetricCallbacks(managerRef as any, () => surface, 'point-thumbnail')

    callbacks.onTrackedRequestStart({
      slotKey: 'thumb-a',
      requestedCandidateUrl: 'https://image.anitabi.cn/points/a.jpg?plan=h160',
      candidateIndex: 0,
      candidateCount: 2,
      reuseChain: false,
    })

    surface = 'nearby'

    callbacks.onTrackedRequestStart({
      slotKey: 'thumb-b',
      requestedCandidateUrl: 'https://image.anitabi.cn/points/b.jpg?plan=h160',
      candidateIndex: 0,
      candidateCount: 2,
      reuseChain: false,
    })

    expect(startRequest.mock.calls[0]?.[0]).toMatchObject({ surface: 'map' })
    expect(startRequest.mock.calls[1]?.[0]).toMatchObject({ surface: 'nearby' })
  })

  it('advances to the next candidate when a DOM image request times out locally', async () => {
    vi.useFakeTimers()
    const requestStart = vi.fn((input) => ({
      requestUrl: input.requestedCandidateUrl,
      requestId: `req-${input.candidateIndex}`,
    }))

    render(
      <ResilientMapImage
        src="https://image.anitabi.cn/points/217249/db2c913d_1754363336601.jpg?w=640&q=80"
        alt="timed-preview"
        kind="point"
        diagnosticSurface="map"
        diagnosticSlotKey="timed-preview"
        onDiagnosticRequestStart={requestStart}
        fallback={<div>fallback</div>}
      />,
    )

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    const initial = screen.getByAltText('timed-preview') as HTMLImageElement
    expect(decodeURIComponent(initial.src)).toContain(
      '/api/anitabi/image-render?url=https://image.anitabi.cn/points/217249/db2c913d_1754363336601.jpg?w=640&q=80',
    )
    expect(requestStart).toHaveBeenCalledTimes(1)

    await act(async () => {
      vi.advanceTimersByTime(8501)
      await Promise.resolve()
      await Promise.resolve()
    })

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(requestStart).toHaveBeenCalledTimes(2)
    expect(requestStart.mock.calls[1]?.[0]).toMatchObject({
      candidateIndex: 1,
      requestedCandidateUrl: expect.stringContaining('_retry=1'),
    })

    vi.useRealTimers()
  })

  it('shortens degraded direct cover retries to 2000ms when breaker v2 is enabled', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(0)
      process.env[BREAKER_FLAG] = '1'
      recordHostFailure('image.anitabi.cn', 'cover', 0)

      const requestStart = vi.fn((input) => ({
        requestUrl: input.requestedCandidateUrl,
        requestId: `req-${input.candidateIndex}`,
      }))

      render(
        <ResilientMapImage
          src="https://www.anitabi.cn/bangumi/290980.jpg"
          alt="degraded-cover"
          kind="cover"
          diagnosticSurface="map"
          diagnosticSlotKey="degraded-cover"
          onDiagnosticRequestStart={requestStart}
          fallback={<div>fallback</div>}
        />,
      )

      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(requestStart).toHaveBeenCalledTimes(1)
      const initial = screen.getByAltText('degraded-cover') as HTMLImageElement
      expect(initial.src).toBe('https://image.anitabi.cn/bangumi/290980.jpg')

      fireEvent.error(initial)

      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(requestStart).toHaveBeenCalledTimes(2)
      expect(requestStart.mock.calls[1]?.[0]).toMatchObject({
        candidateIndex: 1,
        requestedCandidateUrl: 'https://image.anitabi.cn/bangumi/290980.jpg?_retry=1',
      })

      await act(async () => {
        vi.advanceTimersByTime(1999)
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(requestStart).toHaveBeenCalledTimes(2)

      await act(async () => {
        vi.advanceTimersByTime(1)
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(requestStart).toHaveBeenCalledTimes(3)
      expect(requestStart.mock.calls[2]?.[0]).toMatchObject({ candidateIndex: 2 })
      expect(decodeURIComponent(String(requestStart.mock.calls[2]?.[0]?.requestedCandidateUrl || ''))).toContain(
        '/api/anitabi/image-render?url=https://image.anitabi.cn/bangumi/290980.jpg',
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('uses the point timeout window for encoded user bangumi point-preview urls', async () => {
    vi.useFakeTimers()
    const requestStart = vi.fn((input) => ({
      requestUrl: input.requestedCandidateUrl,
      requestId: `req-${input.candidateIndex}`,
    }))

    render(
      <ResilientMapImage
        src="https://image.anitabi.cn/user/0/bangumi/84171/points/ac2hs519n-1687300288099.jpg?plan=h160"
        alt="encoded-point-preview"
        kind="point-preview"
        diagnosticSurface="map"
        diagnosticSlotKey="encoded-point-preview"
        onDiagnosticRequestStart={requestStart}
        fallback={<div>fallback</div>}
      />,
    )

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(requestStart).toHaveBeenCalledTimes(1)

    await act(async () => {
      vi.advanceTimersByTime(6001)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(requestStart).toHaveBeenCalledTimes(1)

    await act(async () => {
      vi.advanceTimersByTime(2500)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(requestStart).toHaveBeenCalledTimes(2)
    expect(requestStart.mock.calls[1]?.[0]).toMatchObject({
      candidateIndex: 1,
      requestedCandidateUrl: expect.stringContaining('_retry=1'),
    })

    vi.useRealTimers()
  })

  it('keeps a new point image on the proxy lane after a same-host timeout', async () => {
    vi.useFakeTimers()

    const { rerender } = render(
      <ResilientMapImage
        src="https://image.anitabi.cn/points/217249/db2c913d_1754363336601.jpg?w=640&q=80"
        alt="timed-preview"
        kind="point"
        fallback={<div>fallback</div>}
      />,
    )

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(screen.getByAltText('timed-preview')).toBeInTheDocument()

    await act(async () => {
      vi.advanceTimersByTime(4001)
      await Promise.resolve()
    })

    await act(async () => {
      rerender(
        <ResilientMapImage
          src="https://image.anitabi.cn/points/999999/next.jpg?w=640&q=80"
          alt="timed-preview"
          kind="point"
          fallback={<div>fallback</div>}
        />,
      )
      await Promise.resolve()
      await Promise.resolve()
    })
    const proxiedCandidate = screen.getByAltText('timed-preview') as HTMLImageElement
    expect(decodeURIComponent(proxiedCandidate.src)).toContain(
      '/api/anitabi/image-render?url=https://image.anitabi.cn/points/999999/next.jpg?w=640&q=80',
    )

    vi.useRealTimers()
  })

  it('waits for an interaction-critical slot before rendering the DOM image request', async () => {
    resetMapImageRequestSchedulerForTest({
      maxActive: 1,
      laneStartThresholds: {
        'interaction-critical': 1,
        'viewport-thumbnail': 1,
        'viewport-visible': 1,
        warmup: 1,
      },
    })

    const blockingLease = await acquireMapImageRequestSlot({ lane: 'viewport-visible' })
    render(
      <ResilientMapImage
        src="https://image.anitabi.cn/points/217249/db2c913d_1754363336601.jpg?w=640&q=80"
        alt="scheduled-preview"
        kind="point"
        fallback={<div>fallback</div>}
      />,
    )

    expect(screen.queryByAltText('scheduled-preview')).not.toBeInTheDocument()

    await act(async () => {
      blockingLease.release()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(screen.getByAltText('scheduled-preview')).toBeInTheDocument()
  })
})
