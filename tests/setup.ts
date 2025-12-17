import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

function rect() {
  return {
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: 0,
    height: 0,
    toJSON: () => ({}),
  } as any
}

// TipTap/ProseMirror rely on DOM APIs missing in jsdom.
if (typeof document !== 'undefined') {
  if (typeof (document as any).elementFromPoint !== 'function') {
    ;(document as any).elementFromPoint = () => null
  }

  if (typeof (HTMLElement.prototype as any).getClientRects !== 'function') {
    ;(HTMLElement.prototype as any).getClientRects = function () {
      return [this.getBoundingClientRect?.() ?? rect()]
    }
  }

  if (typeof (Range.prototype as any).getClientRects !== 'function') {
    ;(Range.prototype as any).getClientRects = () => [rect()]
  }

  if (typeof (Range.prototype as any).getBoundingClientRect !== 'function') {
    ;(Range.prototype as any).getBoundingClientRect = () => rect()
  }
}

afterEach(() => {
  cleanup()
})
