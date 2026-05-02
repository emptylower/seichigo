import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WindowExcerptOverlay } from '@/components/map/WindowExcerptOverlay'

type MockResilientMapImageProps = {
  src: string | null | undefined
  alt: string
  diagnosticSurface?: 'map' | 'nearby'
  diagnosticSlotKey?: string | null
  onDiagnosticRequestStart?: (input: {
    slotKey: string
    surface: 'map' | 'nearby'
    requestedCandidateUrl: string
    candidateIndex: number
    candidateCount: number
    reuseChain: boolean
    queueWaitMs?: number
  }) => { requestUrl: string; requestId: string } | null
  onDiagnosticRequestTerminal?: (input: {
    handle: { requestUrl: string; requestId: string } | null
    terminalState: 'succeeded' | 'failed' | 'aborted' | 'superseded'
    displayOutcome?: 'visible' | 'fallback'
    finalUrl: string
    chainTerminal: boolean
    outcome?: string
  }) => void
}

const mockResilientMapImageProps = vi.hoisted((): MockResilientMapImageProps[] => [])

vi.mock('@/components/map/ResilientMapImage', async () => {
  const React = await import('react')

  function MockResilientMapImage(props: MockResilientMapImageProps) {
    const handleRef = React.useRef<{ requestUrl: string; requestId: string } | null>(null)
    mockResilientMapImageProps.push(props)

    React.useEffect(() => {
      if (!props.diagnosticSurface || !props.diagnosticSlotKey || !props.onDiagnosticRequestStart) {
        handleRef.current = null
        return
      }

      handleRef.current = props.onDiagnosticRequestStart({
        slotKey: props.diagnosticSlotKey,
        surface: props.diagnosticSurface,
        requestedCandidateUrl: props.src || '',
        candidateIndex: 0,
        candidateCount: 1,
        reuseChain: false,
      })
    }, [
      props.diagnosticSlotKey,
      props.diagnosticSurface,
      props.onDiagnosticRequestStart,
      props.src,
    ])

    return (
      <img
        alt={props.alt}
        src={props.src || ''}
        onLoad={() => {
          props.onDiagnosticRequestTerminal?.({
            handle: handleRef.current,
            terminalState: 'succeeded',
            displayOutcome: 'visible',
            finalUrl: handleRef.current?.requestUrl || props.src || '',
            chainTerminal: true,
          })
        }}
      />
    )
  }

  return {
    default: MockResilientMapImage,
  }
})

function pointItem(id: string, name: string, imageUrl: string) {
  return {
    pointId: id,
    pointName: name,
    bangumiId: 1,
    bangumiTitle: 'Test',
    bangumiColor: '#ff0000',
    imageUrl,
    distanceMeters: 0,
    ep: null,
    s: null,
  }
}

describe('WindowExcerptOverlay diagnostics wiring', () => {
  beforeEach(() => {
    mockResilientMapImageProps.length = 0
  })

  it('forwards no diagnostic props to PointCard images when diagnostics is omitted', () => {
    render(
      <WindowExcerptOverlay
        bangumis={[]}
        points={[pointItem('p-1', 'Park', 'https://image.anitabi.cn/bangumi/1.jpg')]}
        activeBangumiId={null}
        activePointId={null}
        onBangumiClick={() => {}}
        onPointClick={() => {}}
      />,
    )

    expect(mockResilientMapImageProps).toHaveLength(1)
    expect(mockResilientMapImageProps[0]?.diagnosticSurface).toBeUndefined()
    expect(mockResilientMapImageProps[0]?.diagnosticSlotKey).toBeUndefined()
    expect(mockResilientMapImageProps[0]?.onDiagnosticRequestStart).toBeUndefined()
    expect(mockResilientMapImageProps[0]?.onDiagnosticRequestTerminal).toBeUndefined()
  })

  it('forwards diagnosticSurface + diagnosticSlotKey to ResilientMapImage when diagnostics prop is given', async () => {
    const onStart = vi.fn(() => ({ requestUrl: 'rsp://req', requestId: 'req-1' }))
    const onTerminal = vi.fn()

    render(
      <WindowExcerptOverlay
        bangumis={[]}
        points={[pointItem('p-42', 'Park', 'https://image.anitabi.cn/bangumi/42.jpg')]}
        activeBangumiId={null}
        activePointId={null}
        onBangumiClick={() => {}}
        onPointClick={() => {}}
        diagnostics={{
          surface: 'nearby',
          onPointRequestStart: onStart,
          onPointRequestTerminal: onTerminal,
        }}
      />,
    )

    await waitFor(() => expect(onStart).toHaveBeenCalled())
    expect(onStart).toHaveBeenCalledWith(expect.objectContaining({
      slotKey: 'dom-window-excerpt-p-42',
      surface: 'nearby',
      candidateIndex: 0,
    }))
  })

  it('emits a terminal event with displayOutcome=visible when the underlying img loads', async () => {
    const onStart = vi.fn(() => ({ requestUrl: 'rsp://req', requestId: 'req-7' }))
    const onTerminal = vi.fn()

    render(
      <WindowExcerptOverlay
        bangumis={[]}
        points={[pointItem('p-7', 'Park', 'https://image.anitabi.cn/bangumi/7.jpg')]}
        activeBangumiId={null}
        activePointId={null}
        onBangumiClick={() => {}}
        onPointClick={() => {}}
        diagnostics={{
          surface: 'nearby',
          onPointRequestStart: onStart,
          onPointRequestTerminal: onTerminal,
        }}
      />,
    )

    await waitFor(() => expect(onStart).toHaveBeenCalled())
    const img = await screen.findByAltText('Park')
    fireEvent.load(img)
    await waitFor(() => expect(onTerminal).toHaveBeenCalled())
    expect(onTerminal).toHaveBeenCalledWith(expect.objectContaining({
      handle: { requestUrl: 'rsp://req', requestId: 'req-7' },
      terminalState: 'succeeded',
      displayOutcome: 'visible',
      chainTerminal: true,
    }))
  })
})
