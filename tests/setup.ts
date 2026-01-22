import '@testing-library/jest-dom/vitest'
import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

// Most unit tests use in-memory repos and should not touch the real DB.
// Provide a safe Prisma stub to avoid accidental connections.
vi.mock('@/lib/db/prisma', () => {
  const noop = async () => []
  const prisma: any = {
    city: { findUnique: async () => null, findMany: noop, create: async () => ({}), update: async () => ({}), upsert: async () => ({}) },
    cityAlias: { findUnique: async () => null, findMany: noop, create: async () => ({}), createMany: async () => ({ count: 0 }), delete: async () => ({}) },
    cityRedirect: { findUnique: async () => null, upsert: async () => ({}) },
    articleCity: { findMany: noop, groupBy: noop, createMany: async () => ({ count: 0 }), deleteMany: async () => ({ count: 0 }) },
    articleRevisionCity: { findMany: noop, createMany: async () => ({ count: 0 }), deleteMany: async () => ({ count: 0 }) },
    submissionCity: { findMany: noop, createMany: async () => ({ count: 0 }), deleteMany: async () => ({ count: 0 }) },
    favorite: { findUnique: async () => null, create: async () => ({}), delete: async () => ({}) },
    mdxFavorite: { findUnique: async () => null, create: async () => ({}), delete: async () => ({}) },
    $transaction: async (fn: any) => fn(prisma),
    $disconnect: async () => {},
  }
  return { prisma }
})

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
