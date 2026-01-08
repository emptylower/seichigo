import React from 'react'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import ProgressiveImagesRuntime from '@/components/content/ProgressiveImagesRuntime'

class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = []
  private readonly callback: IntersectionObserverCallback
  private readonly elements = new Set<Element>()

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback
    MockIntersectionObserver.instances.push(this)
  }

  observe = (el: Element) => {
    this.elements.add(el)
  }

  unobserve = (el: Element) => {
    this.elements.delete(el)
  }

  disconnect = () => {
    this.elements.clear()
  }

  takeRecords = () => []

  trigger(el: Element, isIntersecting: boolean) {
    if (!this.elements.has(el)) return
    this.callback([{ target: el, isIntersecting } as IntersectionObserverEntry], this as any)
  }
}

class MockImage {
  onload: ((this: GlobalEventHandlers, ev: Event) => any) | null = null
  onerror: ((this: GlobalEventHandlers, ev: Event) => any) | null = null
  decoding: string = ''
  private _src = ''

  set src(value: string) {
    this._src = value
    setTimeout(() => {
      this.onload?.call(this as any, new Event('load'))
    }, 0)
  }

  get src() {
    return this._src
  }
}

describe('ProgressiveImagesRuntime', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    MockIntersectionObserver.instances = []
    vi.unstubAllGlobals()
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver as any)
    vi.stubGlobal('Image', MockImage as any)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('upgrades placeholder -> sd -> hd when image enters viewport', async () => {
    const { container } = render(
      <div data-testid="root" data-seichi-article-content="true">
        <img
          alt="x"
          src="/assets/abc123?w=32&q=20"
          data-seichi-full="/assets/abc123"
          data-seichi-sd="/assets/abc123?w=854&q=70"
          data-seichi-hd="/assets/abc123?w=1280&q=80"
          data-seichi-blur="true"
        />
        <ProgressiveImagesRuntime rootSelector='[data-seichi-article-content="true"]' />
      </div>
    )

    const img = container.querySelector('img') as HTMLImageElement
    expect(img.getAttribute('src')).toBe('/assets/abc123?w=32&q=20')
    expect(MockIntersectionObserver.instances.length).toBeGreaterThan(0)

    const observer = MockIntersectionObserver.instances[0]!
    observer.trigger(img, true)
    expect(img.getAttribute('src')).toBe('/assets/abc123?w=854&q=70')

    fireEvent.load(img)
    expect(img.getAttribute('data-seichi-blur')).toBe('false')

    vi.runAllTimers()
    expect(img.getAttribute('src')).toBe('/assets/abc123?w=1280&q=80')
  })

  it('opens lightbox and loads original only when clicked', async () => {
    const { container } = render(
      <div data-seichi-article-content="true">
        <img
          alt="x"
          src="/assets/abc123?w=32&q=20"
          data-seichi-full="/assets/abc123"
          data-seichi-sd="/assets/abc123?w=854&q=70"
          data-seichi-hd="/assets/abc123?w=1280&q=80"
          data-seichi-blur="true"
        />
        <ProgressiveImagesRuntime rootSelector='[data-seichi-article-content="true"]' />
      </div>
    )

    const img = container.querySelector('img') as HTMLImageElement
    expect(img.getAttribute('src')).not.toBe('/assets/abc123')

    fireEvent.click(img)
    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeInTheDocument()
    const full = within(dialog).getByRole('img', { name: 'x' }) as HTMLImageElement
    expect(full.getAttribute('src')).toBe('/assets/abc123')
  })
})
