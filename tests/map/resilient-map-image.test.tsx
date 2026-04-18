import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import ResilientMapImage from '@/components/map/ResilientMapImage'

describe('ResilientMapImage', () => {
  it('retries once with a retry nonce before falling back', () => {
    render(
      <ResilientMapImage
        src="https://lain.bgm.tv/pic/cover/l/b8/0d/513345_jv4wM.jpg"
        alt="cover"
        kind="cover"
        fallback={<div>fallback</div>}
      />
    )

    const img = screen.getByAltText('cover') as HTMLImageElement
    expect(decodeURIComponent(img.src)).toContain('/pic/cover/m/')
    expect(img.src).not.toContain('_retry=1')

    fireEvent.error(img)
    const retried = screen.getByAltText('cover') as HTMLImageElement
    expect(retried.src).toContain('_retry=1')

    fireEvent.error(retried)
    expect(screen.getByText('fallback')).toBeInTheDocument()
  })

  it('emits first-view request and settle callbacks for DOM image slots', () => {
    const requestStart = vi.fn()
    const settle = vi.fn()

    render(
      <ResilientMapImage
        src="https://www.anitabi.cn/images/user/0/a.jpg"
        alt="point"
        kind="point"
        firstViewSlotKey="preview-point-1"
        onFirstViewRequestStart={requestStart}
        onFirstViewSettle={settle}
        fallback={<div>fallback</div>}
      />
    )

    const img = screen.getByAltText('point')
    expect(requestStart).toHaveBeenCalledTimes(1)
    expect(requestStart.mock.calls[0]?.[0]).toMatchObject({
      slotKey: 'preview-point-1',
    })

    fireEvent.load(img)
    expect(settle.mock.calls[0]?.[0]).toMatchObject({
      slotKey: 'preview-point-1',
      state: 'visible',
    })
  })

  it('falls back from direct anitabi bangumi cover to proxy on error', () => {
    render(
      <ResilientMapImage
        src="https://www.anitabi.cn/bangumi/290980.jpg"
        alt="bangumi"
        kind="cover"
        fallback={<div>fallback</div>}
      />
    )

    const img = screen.getByAltText('bangumi') as HTMLImageElement
    expect(img.src).toBe('https://image.anitabi.cn/bangumi/290980.jpg')

    fireEvent.error(img)
    const directRetryCandidate = screen.getByAltText('bangumi') as HTMLImageElement
    expect(directRetryCandidate.src).toBe('https://image.anitabi.cn/bangumi/290980.jpg?_retry=1')

    fireEvent.error(directRetryCandidate)
    const proxyFallbackCandidate = screen.getByAltText('bangumi') as HTMLImageElement
    expect(decodeURIComponent(proxyFallbackCandidate.src)).toContain('/api/anitabi/image-render?url=https://image.anitabi.cn/bangumi/290980.jpg')
  })

  it('keeps anitabi point-photo previews on width-based resize and falls back to proxy only after direct retries', () => {
    render(
      <ResilientMapImage
        src="https://image.anitabi.cn/points/217249/db2c913d_1754363336601.jpg?w=640&q=80"
        alt="point-preview"
        kind="point"
        fallback={<div>fallback</div>}
      />
    )

    const img = screen.getByAltText('point-preview') as HTMLImageElement
    expect(img.src).toBe('https://image.anitabi.cn/points/217249/db2c913d_1754363336601.jpg?w=640&q=80')

    fireEvent.error(img)
    const directRetryCandidate = screen.getByAltText('point-preview') as HTMLImageElement
    expect(directRetryCandidate.src).toBe(
      'https://image.anitabi.cn/points/217249/db2c913d_1754363336601.jpg?w=640&q=80&_retry=1',
    )

    fireEvent.error(directRetryCandidate)
    const proxyFallbackCandidate = screen.getByAltText('point-preview') as HTMLImageElement
    expect(decodeURIComponent(proxyFallbackCandidate.src)).toContain(
      '/api/anitabi/image-render?url=https://image.anitabi.cn/points/217249/db2c913d_1754363336601.jpg?w=640&q=80',
    )
  })
})
