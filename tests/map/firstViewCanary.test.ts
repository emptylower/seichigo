import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { renderFirstViewCanaryMarkdown } from '@/features/map/anitabi/firstViewCanary'

describe('first-view canary artifact', () => {
  it('keeps the markdown artifact in sync with the canonical canary source', () => {
    const actual = readFileSync('.omx/specs/canary-map-first-view-slots.md', 'utf8')
    expect(actual).toBe(renderFirstViewCanaryMarkdown())
  })
})
